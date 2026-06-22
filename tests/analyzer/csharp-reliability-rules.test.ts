import { describe, it, expect } from 'vitest'
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker'
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index'
import { parseCode } from '../../packages/analyzer/src/parser'

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled)

function check(code: string, filePath = '/test/File.cs') {
  const tree = parseCode(code, 'csharp')
  return checkCodeRules(tree, filePath, code, enabledRules, 'csharp')
}

function matches(code: string, ruleKey: string, filePath?: string) {
  return check(code, filePath).filter((v) => v.ruleKey === ruleKey)
}

// ---------------------------------------------------------------------------
// reliability/deterministic/catch-without-error-type
// ---------------------------------------------------------------------------

describe('reliability/deterministic/catch-without-error-type (C#)', () => {
  const key = 'reliability/deterministic/catch-without-error-type'

  it('detects a catch-all that branches on state but never on the exception type', () => {
    const found = matches(`namespace Billing;
public class OrderLoader
{
    private int _retryCount;

    public async Task<Order> LoadAsync(int id)
    {
        try
        {
            return await _repository.GetOrderAsync(id);
        }
        catch (Exception ex)
        {
            if (_retryCount < 3)
            {
                _retryCount++;
                return await LoadAsync(id);
            }
            _logger.LogError(ex, "Failed to load order {Id}", id);
            throw;
        }
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag typed catches, is-pattern checks, when filters, or short uniform handlers', () => {
    const found = matches(`namespace Billing;
public class OrderLoader
{
    public async Task<Order?> LoadAsync(int id)
    {
        try
        {
            return await _repository.GetOrderAsync(id);
        }
        catch (HttpRequestException ex)
        {
            if (_retryCount < 3) { return await LoadAsync(id); }
            throw;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            if (_fallbackEnabled) { return Order.Empty; }
            throw;
        }
    }

    public Order? LoadCached(int id)
    {
        try
        {
            return _cache.Get(id);
        }
        catch (Exception ex)
        {
            if (ex is KeyNotFoundException) { return null; }
            _logger.LogError(ex, "Cache lookup failed for {Id}", id);
            throw;
        }
    }

    public Order? TryLoad(int id)
    {
        try
        {
            return _repository.GetOrder(id);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Load failed for {Id}", id);
        }
        return null;
    }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/promise-all-no-error-handling (Task.WhenAll)
// ---------------------------------------------------------------------------

describe('reliability/deterministic/promise-all-no-error-handling (C#)', () => {
  const key = 'reliability/deterministic/promise-all-no-error-handling'

  it('detects a fire-and-forget Task.WhenAll whose result is discarded', () => {
    const found = matches(`namespace Caching;
public class CacheWarmer
{
    public void WarmAll(IEnumerable<string> regions)
    {
        var tasks = regions.Select(r => _cache.WarmAsync(r));
        Task.WhenAll(tasks);
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag awaited, assigned, or explicitly discarded Task.WhenAll', () => {
    const found = matches(`namespace Caching;
public class CacheWarmer
{
    public async Task WarmAllAsync(IEnumerable<string> regions)
    {
        var tasks = regions.Select(r => _cache.WarmAsync(r));
        await Task.WhenAll(tasks);

        var pending = Task.WhenAll(_replicas.Select(r => r.SyncAsync()));
        await pending;

        _ = Task.WhenAll(_telemetry.Select(t => t.FlushAsync()));
    }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/missing-finally-cleanup
// ---------------------------------------------------------------------------

describe('reliability/deterministic/missing-finally-cleanup (C#)', () => {
  const key = 'reliability/deterministic/missing-finally-cleanup'

  it('detects a resource opened in a try without finally or using', () => {
    const found = matches(`namespace Deploy;
public class ManifestReader
{
    public string ReadManifest(string path)
    {
        try
        {
            var reader = new StreamReader(path);
            return reader.ReadToEnd();
        }
        catch (IOException ex)
        {
            _logger.LogWarning(ex, "Manifest unreadable at {Path}", path);
            return string.Empty;
        }
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag using declarations, using statements, or try/finally cleanup', () => {
    const found = matches(`namespace Deploy;
public class ManifestReader
{
    public string ReadManifest(string path)
    {
        try
        {
            using var reader = new StreamReader(path);
            return reader.ReadToEnd();
        }
        catch (IOException ex)
        {
            _logger.LogWarning(ex, "Manifest unreadable at {Path}", path);
            return string.Empty;
        }
    }

    public byte[] ReadRaw(string path)
    {
        using (var stream = File.OpenRead(path))
        {
            return Compress(stream);
        }
    }

    public string ReadLegacy(string path)
    {
        StreamReader? reader = null;
        try
        {
            reader = new StreamReader(path);
            return reader.ReadToEnd();
        }
        finally
        {
            reader?.Dispose();
        }
    }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/unsafe-json-parse
// ---------------------------------------------------------------------------

describe('reliability/deterministic/unsafe-json-parse (C#)', () => {
  const key = 'reliability/deterministic/unsafe-json-parse'

  it('detects JsonSerializer.Deserialize outside any try/catch', () => {
    const found = matches(`using System.Text.Json;

namespace Config;
public class SettingsLoader
{
    public Settings Load(string raw)
    {
        var settings = JsonSerializer.Deserialize<Settings>(raw);
        return settings ?? Settings.Default;
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag deserialization wrapped in try/catch or the serialize round-trip clone', () => {
    const found = matches(`using System.Text.Json;

namespace Config;
public class SettingsLoader
{
    public Settings Load(string raw)
    {
        try
        {
            return JsonSerializer.Deserialize<Settings>(raw) ?? Settings.Default;
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Invalid settings payload");
            return Settings.Default;
        }
    }

    public Settings Clone(Settings current)
    {
        return JsonSerializer.Deserialize<Settings>(JsonSerializer.Serialize(current))!;
    }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/http-call-no-timeout
// ---------------------------------------------------------------------------

describe('reliability/deterministic/http-call-no-timeout (C#)', () => {
  const key = 'reliability/deterministic/http-call-no-timeout'

  it('detects new HttpClient() relying on the 100s default timeout', () => {
    const found = matches(`namespace Monitoring;
public class StatusChecker
{
    public async Task<string> FetchStatusAsync(string url)
    {
        var client = new HttpClient();
        var response = await client.GetAsync(url);
        return await response.Content.ReadAsStringAsync();
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag clients with Timeout configured or per-call cancellation tokens', () => {
    const found = matches(`namespace Monitoring;
public class StatusChecker
{
    private static readonly HttpClient SharedClient = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };

    public async Task<string> FetchStatusAsync(string url)
    {
        var client = new HttpClient();
        client.Timeout = TimeSpan.FromSeconds(5);
        var response = await client.GetAsync(url);
        return await response.Content.ReadAsStringAsync();
    }

    public async Task<string> ProbeAsync(string url)
    {
        var client = new HttpClient();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        var response = await client.GetAsync(url, cts.Token);
        return await response.Content.ReadAsStringAsync();
    }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/process-exit-in-library
// ---------------------------------------------------------------------------

describe('reliability/deterministic/process-exit-in-library (C#)', () => {
  const key = 'reliability/deterministic/process-exit-in-library'

  it('detects Environment.Exit in a service class', () => {
    const found = matches(`namespace Billing.Services;
public class InvoiceProcessor
{
    public void Process(Invoice invoice)
    {
        if (invoice.Total < 0)
        {
            Environment.Exit(1);
        }
        _ledger.Post(invoice);
    }
}
`, key, '/src/Services/InvoiceProcessor.cs')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag Environment.Exit in entry-point code (static Main / top-level statements)', () => {
    const mainFile = matches(`namespace Migrator;
public static class Program
{
    public static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            Console.WriteLine("usage: migrator <connection-string>");
            Environment.Exit(64);
        }
        return Run(args[0]);
    }

    private static int Run(string connectionString) => 0;
}
`, key, '/src/Migrator/Program.cs')
    expect(mainFile).toHaveLength(0)

    const topLevel = matches(`var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
if (!app.Environment.IsDevelopment() && string.IsNullOrEmpty(app.Configuration["ConnectionStrings:Main"]))
{
    Environment.Exit(78);
}
app.Run();
`, key, '/src/Api/Startup.cs')
    expect(topLevel).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/missing-null-check-after-find
// ---------------------------------------------------------------------------

describe('reliability/deterministic/missing-null-check-after-find (C#)', () => {
  const key = 'reliability/deterministic/missing-null-check-after-find'

  it('detects FirstOrDefault() result dereferenced without a null check', () => {
    const found = matches(`namespace Pricing;
public class PlanService
{
    public decimal GetActivePlanPrice(List<Plan> plans)
    {
        return plans.FirstOrDefault(p => p.IsActive).Price;
    }

    public void ApplyDiscount(List<Plan> plans, decimal rate)
    {
        plans.SingleOrDefault(p => p.IsDefault).Reprice(rate);
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('does not flag null-conditional access, null checks, explicit defaults, or KeyValuePair members', () => {
    const found = matches(`namespace Pricing;
public class PlanService
{
    public decimal? GetActivePlanPrice(List<Plan> plans)
    {
        return plans.FirstOrDefault(p => p.IsActive)?.Price;
    }

    public decimal GetCheckedPrice(List<Plan> plans)
    {
        var plan = plans.FirstOrDefault(p => p.IsActive);
        if (plan == null)
        {
            return 0m;
        }
        return plan.Price;
    }

    public decimal GetPriceOrFallback(List<Plan> plans, Plan fallback)
    {
        return plans.FirstOrDefault(p => p.IsActive, fallback).Price;
    }

    public string TopRegion(Dictionary<string, int> salesByRegion)
    {
        return salesByRegion.FirstOrDefault(kv => kv.Value > 1000).Key;
    }

    public int CompareFirstQuantity(int[] quantities)
    {
        return quantities.FirstOrDefault().CompareTo(0);
    }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/floating-promise (floating Task)
// ---------------------------------------------------------------------------

describe('reliability/deterministic/floating-promise (C#)', () => {
  const key = 'reliability/deterministic/floating-promise'

  it('detects un-awaited statement-position Async calls and Task factory calls', () => {
    const found = matches(`namespace Orders;
public class OrderPlacedHandler
{
    public void Handle(OrderPlaced evt)
    {
        _audit.RecordAsync(evt.OrderId);
        Task.Delay(500);
        _logger.LogInformation("Order {Id} placed", evt.OrderId);
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('does not flag awaited calls, assigned tasks, or explicit discards', () => {
    const found = matches(`namespace Orders;
public class OrderPlacedHandler
{
    public async Task HandleAsync(OrderPlaced evt)
    {
        await _audit.RecordAsync(evt.OrderId);

        var notify = _notifier.SendAsync(evt.OrderId);
        await notify;

        _ = _telemetry.FlushAsync();

        _repository.Save(evt);
    }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/unchecked-optional-chain-depth
// ---------------------------------------------------------------------------

describe('reliability/deterministic/unchecked-optional-chain-depth (C#)', () => {
  const key = 'reliability/deterministic/unchecked-optional-chain-depth'

  it('detects a null-conditional chain deeper than 3 levels', () => {
    const found = matches(`namespace Shipping;
public class LabelFormatter
{
    public string FormatShippingLabel(Order order)
    {
        var city = order?.Customer?.Address?.City?.Name;
        return city ?? "unknown";
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag chains of 3 or fewer levels', () => {
    const found = matches(`namespace Shipping;
public class LabelFormatter
{
    public string FormatShippingLabel(Order order)
    {
        var city = order?.Customer?.Address;
        var country = order?.Customer?.Address?.Country;
        return country ?? "unknown";
    }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/catch-rethrow-no-context
// ---------------------------------------------------------------------------

describe('reliability/deterministic/catch-rethrow-no-context (C#)', () => {
  const key = 'reliability/deterministic/catch-rethrow-no-context'

  it('detects a catch whose entire body rethrows the caught exception', () => {
    const found = matches(`namespace Persistence;
public class EntityStore
{
    public void Save(Entity entity)
    {
        try
        {
            _session.Persist(entity);
        }
        catch (Exception ex)
        {
            throw ex;
        }
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag the multi-catch exclusion idiom or wrapping rethrows', () => {
    const found = matches(`namespace Persistence;
public class EntityStore
{
    public async Task SaveAsync(Entity entity)
    {
        try
        {
            await _session.PersistAsync(entity);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Persist failed for {Id}", entity.Id);
            throw;
        }
    }

    public void SaveWithContext(Entity entity)
    {
        try
        {
            _session.Persist(entity);
        }
        catch (SqlException ex)
        {
            throw new DataAccessException($"Saving entity {entity.Id} failed", ex);
        }
    }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/console-error-no-context
// ---------------------------------------------------------------------------

describe('reliability/deterministic/console-error-no-context (C#)', () => {
  const key = 'reliability/deterministic/console-error-no-context'

  it('detects a caught exception logged with no message', () => {
    const found = matches(`namespace Cleanup;
public class TempFileSweeper
{
    public void Sweep(string tempPath)
    {
        try
        {
            File.Delete(tempPath);
        }
        catch (IOException ex)
        {
            Console.Error.WriteLine(ex);
        }
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag logging with context or identifiers outside a catch', () => {
    const found = matches(`namespace Cleanup;
public class TempFileSweeper
{
    public void Sweep(string tempPath)
    {
        try
        {
            File.Delete(tempPath);
        }
        catch (IOException ex)
        {
            Console.Error.WriteLine($"Failed to delete {tempPath}: {ex}");
        }
    }

    public void Report(string error)
    {
        Console.Error.WriteLine(error);
    }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/invalid-envvar-default
// ---------------------------------------------------------------------------

describe('reliability/deterministic/invalid-envvar-default (C#)', () => {
  const key = 'reliability/deterministic/invalid-envvar-default'

  it('detects an env var fed straight into Parse with no default', () => {
    const found = matches(`namespace Api;
public class ServerConfig
{
    public int ResolvePort()
    {
        return int.Parse(Environment.GetEnvironmentVariable("PORT"));
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag coalesced defaults, TryParse, or null-forgiving fail-fast reads', () => {
    const found = matches(`namespace Api;
public class ServerConfig
{
    public int ResolvePort()
    {
        return int.Parse(Environment.GetEnvironmentVariable("PORT") ?? "8080");
    }

    public bool ResolveDebug()
    {
        return bool.TryParse(Environment.GetEnvironmentVariable("DEBUG"), out var debug) && debug;
    }

    public int ResolveRequiredShard()
    {
        return int.Parse(Environment.GetEnvironmentVariable("SHARD_ID")!);
    }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/dangerous-get-handle
// ---------------------------------------------------------------------------

describe('reliability/deterministic/dangerous-get-handle (C#)', () => {
  const key = 'reliability/deterministic/dangerous-get-handle'

  it('detects a DangerousGetHandle call on a SafeHandle', () => {
    const found = matches(`using System.Runtime.InteropServices;

namespace Interop;
internal sealed class HandleReader
{
    internal nint Raw(SafeHandle handle)
    {
        return handle.DangerousGetHandle();
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag the safe SafeHandle accessors', () => {
    const found = matches(`using System.Runtime.InteropServices;

namespace Interop;
internal sealed class HandleReader
{
    internal bool Touch(SafeHandle handle)
    {
        var added = false;
        handle.DangerousAddRef(ref added);
        try
        {
            return !handle.IsInvalid;
        }
        finally
        {
            if (added) handle.DangerousRelease();
        }
    }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/thread-resume-suspend
// ---------------------------------------------------------------------------

describe('reliability/deterministic/thread-resume-suspend (C#)', () => {
  const key = 'reliability/deterministic/thread-resume-suspend'

  it('detects Thread.Suspend and Thread.Resume', () => {
    const found = matches(`using System.Threading;

namespace Worker;
internal sealed class Pauser
{
    private readonly Thread _worker;

    internal Pauser(Thread worker) => _worker = worker;

    internal void Pause() => _worker.Suspend();

    internal void Continue() => _worker.Resume();
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('does not flag unrelated Suspend/Resume APIs or cooperative pausing', () => {
    const found = matches(`using System.Threading;

namespace Worker;
internal sealed class Pauser
{
    private readonly ManualResetEventSlim _gate = new(true);

    internal void Pause() => _gate.Reset();

    internal void Continue() => _gate.Set();

    internal void SuspendLayout(Panel panel) => panel.SuspendLayout();
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/task-without-taskscheduler
// ---------------------------------------------------------------------------

describe('reliability/deterministic/task-without-taskscheduler (C#)', () => {
  const key = 'reliability/deterministic/task-without-taskscheduler'

  it('detects StartNew and ContinueWith without an explicit scheduler', () => {
    const found = matches(`using System.Threading.Tasks;

namespace Jobs;
internal sealed class Runner
{
    internal void Kick()
    {
        Task.Factory.StartNew(() => Work());
    }

    internal void Chain(Task previous)
    {
        previous.ContinueWith(t => Finish());
    }

    private void Work() { }
    private void Finish() { }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('does not flag calls that pass a TaskScheduler or use Task.Run', () => {
    const found = matches(`using System.Threading.Tasks;

namespace Jobs;
internal sealed class Runner
{
    private readonly TaskScheduler _scheduler = TaskScheduler.Default;

    internal void Kick()
    {
        Task.Factory.StartNew(() => Work(), CancellationToken.None, TaskCreationOptions.None, _scheduler);
    }

    internal void Chain(Task previous)
    {
        previous.ContinueWith(t => Finish(), TaskScheduler.Default);
    }

    internal void Modern()
    {
        Task.Run(() => Work());
    }

    private void Work() { }
    private void Finish() { }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/return-disposable-from-using
// ---------------------------------------------------------------------------

describe('reliability/deterministic/return-disposable-from-using (C#)', () => {
  const key = 'reliability/deterministic/return-disposable-from-using'

  it('detects returning the resource declared by the enclosing using', () => {
    const found = matches(`using System.IO;

namespace Io;
internal sealed class Opener
{
    internal Stream Open(string path)
    {
        using (var stream = File.OpenRead(path))
        {
            return stream;
        }
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag returning data read from the resource or a different object', () => {
    const found = matches(`using System.IO;

namespace Io;
internal sealed class Opener
{
    internal string ReadAll(string path)
    {
        using (var reader = new StreamReader(path))
        {
            return reader.ReadToEnd();
        }
    }

    internal Stream Hand(string path)
    {
        var stream = File.OpenRead(path);
        return stream;
    }

    internal byte[] Snapshot(string path)
    {
        using var source = File.OpenRead(path);
        using var buffer = new MemoryStream();
        source.CopyTo(buffer);
        return buffer.ToArray();
    }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/exception-logged-and-rethrown
// ---------------------------------------------------------------------------

describe('reliability/deterministic/exception-logged-and-rethrown (C#)', () => {
  const key = 'reliability/deterministic/exception-logged-and-rethrown'

  it('detects a catch that logs the exception and then rethrows', () => {
    const found = matches(`namespace Persistence;
internal sealed class EntityStore
{
    private readonly ILogger _logger;

    internal EntityStore(ILogger logger) => _logger = logger;

    internal void Save(Entity entity)
    {
        try
        {
            _session.Persist(entity);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Persist failed for {Id}", entity.Id);
            throw;
        }
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag log-and-handle or wrap-and-rethrow', () => {
    const found = matches(`namespace Persistence;
internal sealed class EntityStore
{
    private readonly ILogger _logger;

    internal EntityStore(ILogger logger) => _logger = logger;

    internal bool TrySave(Entity entity)
    {
        try
        {
            _session.Persist(entity);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Persist failed for {Id}", entity.Id);
            return false;
        }
    }

    internal void SaveOrWrap(Entity entity)
    {
        try
        {
            _session.Persist(entity);
        }
        catch (SqlException ex)
        {
            throw new DataAccessException($"Saving {entity.Id} failed", ex);
        }
    }

    internal void Rethrow(Entity entity)
    {
        try
        {
            _session.Persist(entity);
        }
        catch (Exception)
        {
            throw;
        }
    }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/azure-function-no-error-handling
// ---------------------------------------------------------------------------

describe('reliability/deterministic/azure-function-no-error-handling (C#)', () => {
  const key = 'reliability/deterministic/azure-function-no-error-handling'

  it('detects a [Function] method whose body has no try/catch', () => {
    const found = matches(`using Microsoft.Azure.Functions.Worker;

namespace Functions;
internal sealed class QueueProcessor
{
    private readonly IProcessor _processor;

    internal QueueProcessor(IProcessor processor) => _processor = processor;

    [Function("ProcessQueue")]
    internal void Run([QueueTrigger("orders")] string message)
    {
        var order = Parse(message);
        _processor.Handle(order);
    }

    private static Order Parse(string message) => Order.From(message);
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag functions that wrap their body in try/catch or non-function methods', () => {
    const found = matches(`using Microsoft.Azure.Functions.Worker;

namespace Functions;
internal sealed class QueueProcessor
{
    private readonly IProcessor _processor;
    private readonly ILogger _logger;

    internal QueueProcessor(IProcessor processor, ILogger logger)
    {
        _processor = processor;
        _logger = logger;
    }

    [Function("ProcessQueue")]
    internal void Run([QueueTrigger("orders")] string message)
    {
        try
        {
            var order = Parse(message);
            _processor.Handle(order);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to process {Message}", message);
            throw;
        }
    }

    private static Order Parse(string message) => Order.From(message);
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/azure-function-failure-not-logged
// ---------------------------------------------------------------------------

describe('reliability/deterministic/azure-function-failure-not-logged (C#)', () => {
  const key = 'reliability/deterministic/azure-function-failure-not-logged'

  it('detects a function catch that swallows without logging or rethrowing', () => {
    const found = matches(`using Microsoft.Azure.Functions.Worker;

namespace Functions;
internal sealed class TimerJob
{
    private readonly ISweeper _sweeper;

    internal TimerJob(ISweeper sweeper) => _sweeper = sweeper;

    [Function("Sweep")]
    internal void Run([TimerTrigger("0 */5 * * * *")] TimerInfo timer)
    {
        try
        {
            _sweeper.Sweep();
        }
        catch (Exception)
        {
            _failures++;
        }
    }

    private int _failures;
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag function catches that log or rethrow', () => {
    const found = matches(`using Microsoft.Azure.Functions.Worker;

namespace Functions;
internal sealed class TimerJob
{
    private readonly ISweeper _sweeper;
    private readonly ILogger _logger;

    internal TimerJob(ISweeper sweeper, ILogger logger)
    {
        _sweeper = sweeper;
        _logger = logger;
    }

    [Function("Sweep")]
    internal void Run([TimerTrigger("0 */5 * * * *")] TimerInfo timer)
    {
        try
        {
            _sweeper.Sweep();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Sweep failed");
        }
    }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/disposable-field-without-idisposable
// ---------------------------------------------------------------------------

describe('reliability/deterministic/disposable-field-without-idisposable (C#)', () => {
  const key = 'reliability/deterministic/disposable-field-without-idisposable'

  it('detects a class owning a disposable field that is not IDisposable', () => {
    const found = matches(`using System.IO;

namespace Caching;
internal sealed class FileCache
{
    private readonly FileStream _backing;

    internal FileCache(string path)
    {
        _backing = File.Create(path);
    }

    internal void Append(byte[] data) => _backing.Write(data);
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag disposable classes, static singletons, or non-disposable fields', () => {
    const found = matches(`using System;
using System.IO;
using System.Net.Http;
using System.Text;

namespace Caching;
internal sealed class FileCache : IDisposable
{
    private readonly FileStream _backing;

    internal FileCache(string path)
    {
        _backing = File.Create(path);
    }

    public void Dispose() => _backing.Dispose();
}

internal sealed class HttpGateway
{
    private static readonly HttpClient Shared = new();
    private readonly StringBuilder _buffer = new();

    internal void Note(string line) => _buffer.AppendLine(line);
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/dispose-own-members
// ---------------------------------------------------------------------------

describe('reliability/deterministic/dispose-own-members (C#)', () => {
  const key = 'reliability/deterministic/dispose-own-members'

  it('detects a Dispose that leaves an owned disposable field undisposed', () => {
    const found = matches(`using System;
using System.IO;

namespace Caching;
internal sealed class DualWriter : IDisposable
{
    private readonly StreamWriter _primary;
    private readonly StreamWriter _secondary;

    internal DualWriter(string a, string b)
    {
        _primary = new StreamWriter(a);
        _secondary = new StreamWriter(b);
    }

    public void Dispose()
    {
        _primary.Dispose();
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a Dispose that releases every owned field, including via Dispose(bool)', () => {
    const found = matches(`using System;
using System.IO;

namespace Caching;
internal sealed class DualWriter : IDisposable
{
    private readonly StreamWriter _primary;
    private readonly StreamWriter _secondary;

    internal DualWriter(string a, string b)
    {
        _primary = new StreamWriter(a);
        _secondary = new StreamWriter(b);
    }

    public void Dispose()
    {
        _primary.Dispose();
        _secondary.Dispose();
    }
}

internal class PatternWriter : IDisposable
{
    private readonly StreamWriter _writer;

    internal PatternWriter(string path) => _writer = new StreamWriter(path);

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    protected virtual void Dispose(bool disposing)
    {
        if (disposing)
        {
            _writer?.Dispose();
        }
    }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/disposable-without-finalizer
// ---------------------------------------------------------------------------

describe('reliability/deterministic/disposable-without-finalizer (C#)', () => {
  const key = 'reliability/deterministic/disposable-without-finalizer'

  it('detects an IDisposable holding an IntPtr with no finalizer', () => {
    const found = matches(`using System;

namespace Interop;
internal sealed class NativeBuffer : IDisposable
{
    private IntPtr _buffer;

    internal NativeBuffer(int size)
    {
        _buffer = Allocate(size);
    }

    public void Dispose()
    {
        Free(_buffer);
        _buffer = IntPtr.Zero;
    }

    private static IntPtr Allocate(int size) => IntPtr.Zero;
    private static void Free(IntPtr p) { }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag managed disposables or unmanaged ones that declare a finalizer', () => {
    const found = matches(`using System;
using System.IO;

namespace Interop;
internal sealed class ManagedWrapper : IDisposable
{
    private readonly FileStream _stream;

    internal ManagedWrapper(string path) => _stream = File.Create(path);

    public void Dispose() => _stream.Dispose();
}

internal sealed class GuardedBuffer : IDisposable
{
    private IntPtr _buffer;

    internal GuardedBuffer(int size) => _buffer = Allocate(size);

    ~GuardedBuffer() => Free(_buffer);

    public void Dispose()
    {
        Free(_buffer);
        _buffer = IntPtr.Zero;
        GC.SuppressFinalize(this);
    }

    private static IntPtr Allocate(int size) => IntPtr.Zero;
    private static void Free(IntPtr p) { }
}
`, key)
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reliability/deterministic/idisposable-pattern-incorrect
// ---------------------------------------------------------------------------

describe('reliability/deterministic/idisposable-pattern-incorrect (C#)', () => {
  const key = 'reliability/deterministic/idisposable-pattern-incorrect'

  it('detects a finalizer + public Dispose with no unifying Dispose(bool)', () => {
    const found = matches(`using System;

namespace Interop;
internal class ResourceOwner : IDisposable
{
    private IntPtr _handle;

    internal ResourceOwner() => _handle = Acquire();

    ~ResourceOwner()
    {
        Release(_handle);
    }

    public void Dispose()
    {
        Release(_handle);
        _handle = IntPtr.Zero;
    }

    private static IntPtr Acquire() => IntPtr.Zero;
    private static void Release(IntPtr h) { }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag the correct Dispose(bool) pattern or managed-only disposables', () => {
    const found = matches(`using System;

namespace Interop;
internal class ResourceOwner : IDisposable
{
    private IntPtr _handle;

    internal ResourceOwner() => _handle = Acquire();

    ~ResourceOwner()
    {
        Dispose(false);
    }

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    protected virtual void Dispose(bool disposing)
    {
        Release(_handle);
        _handle = IntPtr.Zero;
    }

    private static IntPtr Acquire() => IntPtr.Zero;
    private static void Release(IntPtr h) { }
}

internal sealed class SimpleManaged : IDisposable
{
    public void Dispose() { }
}
`, key)
    expect(found).toHaveLength(0)
  })
})
