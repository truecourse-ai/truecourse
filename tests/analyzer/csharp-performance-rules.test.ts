import { describe, it, expect } from 'vitest'
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker'
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index'
import { parseCode } from '../../packages/analyzer/src/parser'

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled)

function check(code: string) {
  const tree = parseCode(code, 'csharp')
  return checkCodeRules(tree, '/test/File.cs', code, enabledRules, 'csharp')
}

function matches(code: string, ruleKey: string) {
  return check(code).filter((v) => v.ruleKey === `performance/deterministic/${ruleKey}`)
}

// ---------------------------------------------------------------------------
// performance/deterministic/regex-in-loop
// ---------------------------------------------------------------------------

describe('performance/deterministic/regex-in-loop (C#)', () => {
  it('detects new Regex(...) constructed inside a loop', () => {
    const found = matches(`using System.Text.RegularExpressions;

namespace App.Logs;

public class LogScrubber
{
    public List<string> Scrub(IEnumerable<string> lines)
    {
        var cleaned = new List<string>();
        foreach (var line in lines)
        {
            var emailPattern = new Regex(@"[\\w.+-]+@[\\w-]+\\.[\\w.]+");
            cleaned.Add(emailPattern.Replace(line, "[redacted]"));
        }
        return cleaned;
    }
}
`, 'regex-in-loop')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a hoisted static readonly Regex used in a loop', () => {
    const found = matches(`using System.Text.RegularExpressions;

namespace App.Logs;

public class LogScrubber
{
    private static readonly Regex EmailPattern = new Regex(@"[\\w.+-]+@[\\w-]+\\.[\\w.]+");

    public List<string> Scrub(IEnumerable<string> lines)
    {
        var cleaned = new List<string>();
        foreach (var line in lines)
        {
            cleaned.Add(EmailPattern.Replace(line, "[redacted]"));
        }
        return cleaned;
    }
}
`, 'regex-in-loop')
    expect(found).toHaveLength(0)
  })

  it('does not flag the static Regex.IsMatch helpers, which cache internally', () => {
    const found = matches(`using System.Text.RegularExpressions;

namespace App.Validation;

public class SkuValidator
{
    public List<string> Invalid(List<string> skus)
    {
        var invalid = new List<string>();
        foreach (var sku in skus)
        {
            if (!Regex.IsMatch(sku, "^[A-Z]{3}-")) invalid.Add(sku);
        }
        return invalid;
    }
}
`, 'regex-in-loop')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// performance/deterministic/sync-fs-in-request-handler
// ---------------------------------------------------------------------------

describe('performance/deterministic/sync-fs-in-request-handler (C#)', () => {
  it('detects File.ReadAllText inside an async method', () => {
    const found = matches(`using System.IO;
using System.Threading.Tasks;

namespace App.Reports;

public class ReportService
{
    public async Task<string> BuildAsync(string templatePath, IReportData data)
    {
        var template = File.ReadAllText(templatePath);
        var rows = await data.LoadRowsAsync();
        return template.Replace("{{rows}}", string.Join("\\n", rows));
    }
}
`, 'sync-fs-in-request-handler')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects .Result on a task inside an async method', () => {
    const found = matches(`using System.Net.Http;
using System.Threading.Tasks;

namespace App.Sync;

public class InventoryClient
{
    private readonly HttpClient _http;

    public async Task<int> RefreshAsync(string url)
    {
        var response = _http.GetAsync(url).Result;
        await Task.Delay(100);
        return (int)response.StatusCode;
    }
}
`, 'sync-fs-in-request-handler')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects .Wait() and Thread.Sleep inside async code', () => {
    const found = matches(`using System.Threading;
using System.Threading.Tasks;

namespace App.Jobs;

public class WarmupJob
{
    public async Task RunAsync(Task migrationTask)
    {
        migrationTask.Wait();
        Thread.Sleep(2000);
        await Task.CompletedTask;
    }
}
`, 'sync-fs-in-request-handler')
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('detects sync file I/O inside an async lambda', () => {
    const found = matches(`using System.IO;

namespace App.Startup;

public class CacheWarmer
{
    public void Schedule(IJobRunner runner)
    {
        runner.Enqueue(async () =>
        {
            var seed = File.ReadAllText("seed/catalog.json");
            await PrimeAsync(seed);
        });
    }

    private Task PrimeAsync(string seed) => Task.CompletedTask;
}
`, 'sync-fs-in-request-handler')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects sync file I/O inside a minimal-API route handler lambda', () => {
    const found = matches(`using Microsoft.AspNetCore.Builder;
using System.IO;

var app = WebApplication.Create(args);
app.MapGet("/config", (string name) => File.ReadAllText($"configs/{name}.json"));
app.Run();
`, 'sync-fs-in-request-handler')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag awaited async I/O or sync I/O in sync methods', () => {
    const found = matches(`using System.IO;
using System.Threading.Tasks;

namespace App.Reports;

public class ReportService
{
    public async Task<string> BuildAsync(string templatePath)
    {
        var template = await File.ReadAllTextAsync(templatePath);
        return template;
    }

    public string LoadVersion(string path)
    {
        return File.ReadAllText(path);
    }
}
`, 'sync-fs-in-request-handler')
    expect(found).toHaveLength(0)
  })

  it('does not flag GetAwaiter().GetResult() in a synchronous Main', () => {
    const found = matches(`using System.Threading.Tasks;

namespace App;

public static class Program
{
    public static void Main(string[] args)
    {
        new Host().RunAsync(args).GetAwaiter().GetResult();
    }
}
`, 'sync-fs-in-request-handler')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// performance/deterministic/json-parse-in-loop
// ---------------------------------------------------------------------------

describe('performance/deterministic/json-parse-in-loop (C#)', () => {
  it('detects serializing the same object on every loop iteration', () => {
    const found = matches(`using System.Text.Json;

namespace App.Audit;

public class AuditLogger
{
    private readonly IAuditSink _sink;

    public void Write(List<AuditEntry> entries, ExportSettings settings)
    {
        foreach (var entry in entries)
        {
            var header = JsonSerializer.Serialize(settings);
            _sink.Append(header, entry.Id);
        }
    }
}
`, 'json-parse-in-loop')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag deserializing indexed items in a for loop', () => {
    const found = matches(`using System.Text.Json;

namespace App.Import;

public class BatchParser
{
    public List<Order> Parse(string[] payloads)
    {
        var orders = new List<Order>();
        for (var i = 0; i < payloads.Length; i++)
        {
            var order = JsonSerializer.Deserialize<Order>(payloads[i]);
            if (order != null) orders.Add(order);
        }
        return orders;
    }
}
`, 'json-parse-in-loop')
    expect(found).toHaveLength(0)
  })

  it('does not flag per-item deserialization of the loop variable', () => {
    const found = matches(`using System.Text.Json;

namespace App.Import;

public class OrderImporter
{
    public List<Order> Parse(IEnumerable<string> lines)
    {
        var orders = new List<Order>();
        foreach (var line in lines)
        {
            var order = JsonSerializer.Deserialize<Order>(line);
            if (order != null) orders.Add(order);
        }
        return orders;
    }
}
`, 'json-parse-in-loop')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// performance/deterministic/quadratic-list-summation (string += in loop)
// ---------------------------------------------------------------------------

describe('performance/deterministic/quadratic-list-summation (C#)', () => {
  it('detects string concatenation with += inside a loop', () => {
    const found = matches(`namespace App.Export;

public class CsvExporter
{
    public string ToCsv(List<Order> orders)
    {
        var csv = "";
        foreach (var order in orders)
        {
            csv += order.Id + "," + order.Total + "\\n";
        }
        return csv;
    }
}
`, 'quadratic-list-summation')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag StringBuilder accumulation or numeric +=', () => {
    const found = matches(`using System.Text;

namespace App.Export;

public class CsvExporter
{
    public string ToCsv(List<Order> orders)
    {
        var sb = new StringBuilder();
        decimal grandTotal = 0;
        foreach (var order in orders)
        {
            sb.Append(order.Id).Append(',').AppendLine();
            grandTotal += order.Total;
        }
        return sb.ToString();
    }
}
`, 'quadratic-list-summation')
    expect(found).toHaveLength(0)
  })

  it('does not flag += on a string reset at the top of each iteration', () => {
    const found = matches(`namespace App.Export;

public class LabelPrinter
{
    public void Print(List<Parcel> parcels, IPrinter printer)
    {
        foreach (var parcel in parcels)
        {
            var label = parcel.Recipient;
            label += " — " + parcel.Address;
            printer.Print(label);
        }
    }
}
`, 'quadratic-list-summation')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// performance/deterministic/batch-writes-in-loop
// ---------------------------------------------------------------------------

describe('performance/deterministic/batch-writes-in-loop (C#)', () => {
  it('detects EF Core SaveChangesAsync inside a loop', () => {
    const found = matches(`using Microsoft.EntityFrameworkCore;

namespace App.Import;

public class OrderImporter
{
    private readonly ShopContext _db;

    public async Task ImportAsync(List<Order> orders)
    {
        foreach (var order in orders)
        {
            _db.Orders.Add(order);
            await _db.SaveChangesAsync();
        }
    }
}
`, 'batch-writes-in-loop')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects Dapper ExecuteAsync per iteration', () => {
    const found = matches(`using Dapper;
using System.Data;

namespace App.Pricing;

public class PriceUpdater
{
    public async Task ApplyAsync(IDbConnection connection, List<PriceChange> changes)
    {
        foreach (var change in changes)
        {
            await connection.ExecuteAsync(
                "UPDATE products SET price = @Price WHERE id = @Id", change);
        }
    }
}
`, 'batch-writes-in-loop')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects the EF Core N+1 query shape inside a loop', () => {
    const found = matches(`using Microsoft.EntityFrameworkCore;

namespace App.Crm;

public class CustomerLookup
{
    private readonly CrmContext _db;

    public async Task<List<Customer>> LoadAsync(List<int> customerIds)
    {
        var customers = new List<Customer>();
        foreach (var id in customerIds)
        {
            var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Id == id);
            if (customer != null) customers.Add(customer);
        }
        return customers;
    }
}
`, 'batch-writes-in-loop')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag SaveChanges after the loop or batched Dapper writes', () => {
    const found = matches(`using Dapper;
using Microsoft.EntityFrameworkCore;
using System.Data;

namespace App.Import;

public class OrderImporter
{
    private readonly ShopContext _db;

    public async Task ImportAsync(IDbConnection connection, List<Order> orders)
    {
        foreach (var order in orders)
        {
            _db.Orders.Add(order);
        }
        await _db.SaveChangesAsync();
        await connection.ExecuteAsync(
            "INSERT INTO order_audit (id) VALUES (@Id)", orders);
    }
}
`, 'batch-writes-in-loop')
    expect(found).toHaveLength(0)
  })

  it('does not flag Polly-style policy.Execute in a loop even when Dapper is imported', () => {
    const found = matches(`using Dapper;
using Polly;

namespace App.Resilience;

public class WebhookDispatcher
{
    public void DispatchAll(Policy retryPolicy, List<Webhook> hooks)
    {
        foreach (var hook in hooks)
        {
            retryPolicy.Execute(() => Send(hook));
        }
    }

    private void Send(Webhook hook) { }
}
`, 'batch-writes-in-loop')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// performance/deterministic/incorrect-dict-iterator
// ---------------------------------------------------------------------------

describe('performance/deterministic/incorrect-dict-iterator (C#)', () => {
  it('detects iterating .Keys while reading values through the indexer', () => {
    const found = matches(`namespace App.Pricing;

public class CartCalculator
{
    public decimal TotalValue(Dictionary<string, decimal> prices)
    {
        decimal total = 0;
        foreach (var sku in prices.Keys)
        {
            total += prices[sku];
        }
        return total;
    }
}
`, 'incorrect-dict-iterator')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag iterating pairs, or .Keys used to write values back', () => {
    const found = matches(`namespace App.Pricing;

public class CartCalculator
{
    public decimal TotalValue(Dictionary<string, decimal> prices)
    {
        decimal total = 0;
        foreach (var (sku, price) in prices)
        {
            total += price;
        }
        return total;
    }

    public void ApplyInflation(Dictionary<string, decimal> prices)
    {
        foreach (var sku in prices.Keys)
        {
            prices[sku] = prices[sku] * 1.1m;
        }
    }
}
`, 'incorrect-dict-iterator')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// performance/deterministic/sorted-for-min-max
// ---------------------------------------------------------------------------

describe('performance/deterministic/sorted-for-min-max (C#)', () => {
  it('detects OrderBy(...).First() used to find an extremum', () => {
    const found = matches(`using System.Linq;

namespace App.Catalog;

public class DealFinder
{
    public Product Cheapest(List<Product> products)
    {
        return products.OrderBy(p => p.Price).First();
    }

    public Build? Newest(List<Build> builds)
    {
        return builds.OrderByDescending(b => b.CreatedAt).FirstOrDefault();
    }
}
`, 'sorted-for-min-max')
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('does not flag top-N queries or DbContext-rooted chains', () => {
    const found = matches(`using System.Linq;
using Microsoft.EntityFrameworkCore;

namespace App.Catalog;

public class DealFinder
{
    private readonly CatalogContext _db;

    public List<Product> TopFive(List<Product> products)
    {
        return products.OrderBy(p => p.Price).Take(5).ToList();
    }

    public Product? CheapestInStore()
    {
        return _db.Products.OrderBy(p => p.Price).FirstOrDefault();
    }
}
`, 'sorted-for-min-max')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// performance/deterministic/list-comprehension-in-any-all
// ---------------------------------------------------------------------------

describe('performance/deterministic/list-comprehension-in-any-all (C#)', () => {
  it('detects ToList() before Any(), which defeats short-circuiting', () => {
    const found = matches(`using System.Linq;

namespace App.Orders;

public class FraudScreen
{
    public bool HasLargeOrder(List<Order> orders, decimal threshold)
    {
        return orders.Where(o => o.Total > threshold).ToList().Any();
    }
}
`, 'list-comprehension-in-any-all')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag Any() with a predicate on the lazy sequence', () => {
    const found = matches(`using System.Linq;

namespace App.Orders;

public class FraudScreen
{
    public bool HasLargeOrder(List<Order> orders, decimal threshold)
    {
        return orders.Any(o => o.Total > threshold);
    }
}
`, 'list-comprehension-in-any-all')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// performance/deterministic/unnecessary-list-cast
// ---------------------------------------------------------------------------

describe('performance/deterministic/unnecessary-list-cast (C#)', () => {
  it('detects back-to-back ToList().ToArray()', () => {
    const found = matches(`using System.Linq;

namespace App.Users;

public class UserDirectory
{
    public string[] ActiveNames(List<User> users)
    {
        return users.Where(u => u.IsActive).Select(u => u.Name).ToList().ToArray();
    }
}
`, 'unnecessary-list-cast')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a single materialization', () => {
    const found = matches(`using System.Linq;

namespace App.Users;

public class UserDirectory
{
    public List<string> ActiveNames(List<User> users)
    {
        return users.Where(u => u.IsActive).Select(u => u.Name).ToList();
    }
}
`, 'unnecessary-list-cast')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// performance/deterministic/unnecessary-iterable-allocation
// ---------------------------------------------------------------------------

describe('performance/deterministic/unnecessary-iterable-allocation (C#)', () => {
  it('detects ToList() in a foreach header that only enumerates once', () => {
    const found = matches(`using System.Linq;

namespace App.Notify;

public class Notifier
{
    public void NotifyActive(List<User> users, IEmailGateway gateway)
    {
        foreach (var user in users.Where(u => u.IsActive).ToList())
        {
            gateway.Send(user.Email, "Your weekly digest is ready");
        }
    }
}
`, 'unnecessary-iterable-allocation')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a snapshot taken because the loop mutates the source', () => {
    const found = matches(`using System.Linq;

namespace App.Pool;

public class ConnectionPool
{
    private readonly List<PooledConnection> connections = new();

    public void Sweep()
    {
        foreach (var conn in connections.ToList())
        {
            if (conn.IsStale) connections.Remove(conn);
        }
    }
}
`, 'unnecessary-iterable-allocation')
    expect(found).toHaveLength(0)
  })

  it('does not flag enumerating a lazy sequence directly', () => {
    const found = matches(`using System.Linq;

namespace App.Notify;

public class Notifier
{
    public void NotifyActive(List<User> users, IEmailGateway gateway)
    {
        foreach (var user in users.Where(u => u.IsActive))
        {
            gateway.Send(user.Email, "Your weekly digest is ready");
        }
    }
}
`, 'unnecessary-iterable-allocation')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// performance/deterministic/event-listener-no-remove
// ---------------------------------------------------------------------------

describe('performance/deterministic/event-listener-no-remove (C#)', () => {
  it('detects subscribing to an injected publisher without unsubscribing', () => {
    const found = matches(`namespace App.Projections;

public class OrderProjection
{
    private readonly IEventBus _bus;

    public OrderProjection(IEventBus bus)
    {
        _bus = bus;
        _bus.OrderPlaced += OnOrderPlaced;
    }

    private void OnOrderPlaced(object sender, OrderPlacedEventArgs e)
    {
        Rebuild(e.OrderId);
    }

    private void Rebuild(int orderId) { }
}
`, 'event-listener-no-remove')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects a lambda subscribed to a static event with no unsubscription', () => {
    const found = matches(`using System;

namespace App.Diagnostics;

public class TelemetryHook
{
    public TelemetryHook(ILogger logger)
    {
        AppDomain.CurrentDomain.FirstChanceException += (s, e) => logger.Warn(e.Exception.Message);
    }
}
`, 'event-listener-no-remove')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag subscriptions paired with -= in Dispose', () => {
    const found = matches(`using System;

namespace App.Projections;

public class OrderProjection : IDisposable
{
    private readonly IEventBus _bus;

    public OrderProjection(IEventBus bus)
    {
        _bus = bus;
        _bus.OrderPlaced += OnOrderPlaced;
    }

    public void Dispose()
    {
        _bus.OrderPlaced -= OnOrderPlaced;
    }

    private void OnOrderPlaced(object sender, OrderPlacedEventArgs e) { }
}
`, 'event-listener-no-remove')
    expect(found).toHaveLength(0)
  })

  it('does not flag numeric += or events on method-local objects', () => {
    const found = matches(`using System.IO;

namespace App.Billing;

public class InvoiceBuilder
{
    public decimal Build(Invoice invoice, List<LineItem> items)
    {
        foreach (var line in items)
        {
            invoice.Total += line.Amount;
        }

        var watcher = new FileSystemWatcher("/var/billing");
        watcher.Changed += (s, e) => Reload();
        return invoice.Total;
    }

    private void Reload() { }
}
`, 'event-listener-no-remove')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// performance/deterministic/set-mutations-in-loop
// ---------------------------------------------------------------------------

describe('performance/deterministic/set-mutations-in-loop (C#)', () => {
  it('detects a foreach whose entire body is collection.Add(item)', () => {
    const found = matches(`namespace App.Retry;

public class RetryScheduler
{
    private readonly HashSet<int> retryQueue = new();

    public void Enqueue(IEnumerable<int> failedIds)
    {
        foreach (var id in failedIds)
        {
            retryQueue.Add(id);
        }
    }
}
`, 'set-mutations-in-loop')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag Add() of a transformed element or bulk UnionWith', () => {
    const found = matches(`namespace App.Retry;

public class RetryScheduler
{
    private readonly HashSet<int> retryQueue = new();
    private readonly List<decimal> totals = new();

    public void Record(IEnumerable<int> failedIds, List<Order> orders)
    {
        retryQueue.UnionWith(failedIds);
        foreach (var order in orders)
        {
            totals.Add(order.Total);
        }
    }
}
`, 'set-mutations-in-loop')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// performance/deterministic/settimeout-setinterval-no-clear
// ---------------------------------------------------------------------------

describe('performance/deterministic/settimeout-setinterval-no-clear (C#)', () => {
  it('detects a Timer created and immediately discarded', () => {
    const found = matches(`using System;
using System.Threading;

namespace App.Health;

public class HeartbeatService
{
    public void Start()
    {
        new Timer(_ => SendHeartbeat(), null, TimeSpan.Zero, TimeSpan.FromSeconds(30));
    }

    private void SendHeartbeat() { }
}
`, 'settimeout-setinterval-no-clear')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag timers stored in a field or a using declaration', () => {
    const found = matches(`using System;
using System.Threading;

namespace App.Health;

public class HeartbeatService : IDisposable
{
    private Timer? _timer;

    public void Start()
    {
        _timer = new Timer(_ => SendHeartbeat(), null, TimeSpan.Zero, TimeSpan.FromSeconds(30));
    }

    public async Task TickOnceAsync()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        await timer.WaitForNextTickAsync();
    }

    public void Dispose() => _timer?.Dispose();

    private void SendHeartbeat() { }
}
`, 'settimeout-setinterval-no-clear')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// performance/deterministic/unbounded-array-growth
// ---------------------------------------------------------------------------

describe('performance/deterministic/unbounded-array-growth (C#)', () => {
  it('detects .Add() in a polling loop with no bound or pruning', () => {
    const found = matches(`using System.Threading;
using System.Threading.Tasks;

namespace App.Telemetry;

public class SensorCollector
{
    private readonly List<Sample> _samples = new();

    public async Task PollAsync(ISensor sensor, CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            var sample = sensor.Read();
            _samples.Add(sample);
            await Task.Delay(1000, token);
        }
    }
}
`, 'unbounded-array-growth')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag reader-driven loops or advancing index loops', () => {
    const found = matches(`using System.IO;

namespace App.Import;

public class FileLoader
{
    public List<string> LoadLines(StreamReader reader)
    {
        var lines = new List<string>();
        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            lines.Add(line);
        }
        return lines;
    }

    public List<Job> TakeBatch(List<Job> retries, int batchSize)
    {
        var batch = new List<Job>();
        var i = 0;
        while (i < batchSize)
        {
            batch.Add(retries[i]);
            i++;
        }
        return batch;
    }
}
`, 'unbounded-array-growth')
    expect(found).toHaveLength(0)
  })

  it('does not flag loops that prune the collection past a size cap', () => {
    const found = matches(`using System.Threading;

namespace App.Telemetry;

public class RollingBuffer
{
    private readonly List<Sample> _samples = new();

    public void Collect(ISensor sensor, CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            _samples.Add(sensor.Read());
            if (_samples.Count > 10000)
            {
                _samples.RemoveAt(0);
            }
        }
    }
}
`, 'unbounded-array-growth')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// performance/deterministic/spread-in-reduce
// ---------------------------------------------------------------------------

describe('performance/deterministic/spread-in-reduce (C#)', () => {
  it('detects Aggregate() rebuilding the accumulator with Concat', () => {
    const found = matches(`using System.Linq;

namespace App.Content;

public class TagIndex
{
    public List<string> AllTags(List<Article> articles)
    {
        return articles
            .Aggregate(Enumerable.Empty<string>(), (acc, article) => acc.Concat(article.Tags))
            .ToList();
    }
}
`, 'spread-in-reduce')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag scalar folds or mutating folds', () => {
    const found = matches(`using System.Linq;

namespace App.Billing;

public class PaymentSummary
{
    public decimal Total(List<Payment> payments)
    {
        return payments.Aggregate(0m, (sum, p) => sum + p.Amount);
    }

    public List<string> AllTags(List<Article> articles)
    {
        return articles.Aggregate(new List<string>(), (acc, article) =>
        {
            acc.AddRange(article.Tags);
            return acc;
        });
    }
}
`, 'spread-in-reduce')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// performance/deterministic/str-replace-over-re-sub
// ---------------------------------------------------------------------------

describe('performance/deterministic/str-replace-over-re-sub (C#)', () => {
  it('detects Regex.Replace with a plain string pattern', () => {
    const found = matches(`using System.Text.RegularExpressions;

namespace App.Content;

public class SlugBuilder
{
    public string Slugify(string title)
    {
        return Regex.Replace(title, " ", "-").ToLowerInvariant();
    }
}
`, 'str-replace-over-re-sub')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag patterns with regex metacharacters', () => {
    const found = matches(`using System.Text.RegularExpressions;

namespace App.Content;

public class WhitespaceNormalizer
{
    public string Normalize(string input)
    {
        return Regex.Replace(input, @"\\s+", " ");
    }
}
`, 'str-replace-over-re-sub')
    expect(found).toHaveLength(0)
  })
})
