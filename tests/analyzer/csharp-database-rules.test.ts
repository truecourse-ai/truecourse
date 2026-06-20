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
// database/deterministic/select-star
// ---------------------------------------------------------------------------

describe('database/deterministic/select-star (C#)', () => {
  it('detects SELECT * in a Dapper query', () => {
    const found = matches(`using System.Collections.Generic;
using System.Data;
using Dapper;

namespace Billing.Repositories;

public class InvoiceRepository
{
    private readonly IDbConnection _connection;

    public InvoiceRepository(IDbConnection connection) => _connection = connection;

    public IEnumerable<Invoice> GetOverdue()
    {
        return _connection.Query<Invoice>("SELECT * FROM invoices WHERE due_date < now()");
    }
}
`, 'database/deterministic/select-star')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects SELECT * assigned to an ADO.NET CommandText', () => {
    const found = matches(`using Microsoft.Data.SqlClient;

namespace Billing.Reports;

public class CustomerExport
{
    public void Run(SqlConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT * FROM customers";
        using var reader = cmd.ExecuteReader();
    }
}
`, 'database/deterministic/select-star')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag explicit column lists or COUNT(*)', () => {
    const found = matches(`using System.Data;
using Dapper;

namespace Billing.Repositories;

public class InvoiceRepository
{
    private readonly IDbConnection _connection;

    public InvoiceRepository(IDbConnection connection) => _connection = connection;

    public IEnumerable<Invoice> GetOverdue()
    {
        return _connection.Query<Invoice>("SELECT id, total, due_date FROM invoices WHERE due_date < now()");
    }

    public int CountOverdue()
    {
        return _connection.ExecuteScalar<int>("SELECT COUNT(*) FROM invoices WHERE due_date < now()");
    }
}
`, 'database/deterministic/select-star')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// database/deterministic/unsafe-delete-without-where
// ---------------------------------------------------------------------------

describe('database/deterministic/unsafe-delete-without-where (C#)', () => {
  it('detects DELETE without WHERE in raw SQL', () => {
    const found = matches(`using System.Data;
using Dapper;

namespace Ops.Maintenance;

public class AuditLogCleaner
{
    public void Clean(IDbConnection connection)
    {
        connection.Execute("DELETE FROM audit_logs");
    }
}
`, 'database/deterministic/unsafe-delete-without-where')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects UPDATE without WHERE in a CommandText assignment', () => {
    const found = matches(`using Microsoft.Data.SqlClient;

namespace Ops.Maintenance;

public class UserDeactivator
{
    public void DeactivateAll(SqlConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "UPDATE users SET active = 0";
        cmd.ExecuteNonQuery();
    }
}
`, 'database/deterministic/unsafe-delete-without-where')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects EF Core ExecuteDeleteAsync on an unfiltered set', () => {
    const found = matches(`using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;

namespace Auth.Services;

public class SessionService
{
    private readonly AuthDbContext _db;

    public SessionService(AuthDbContext db) => _db = db;

    public async Task PurgeAsync()
    {
        await _db.Sessions.ExecuteDeleteAsync();
    }
}
`, 'database/deterministic/unsafe-delete-without-where')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag filtered deletes (raw WHERE or EF .Where chain)', () => {
    const found = matches(`using System;
using System.Data;
using System.Threading.Tasks;
using Dapper;
using Microsoft.EntityFrameworkCore;

namespace Auth.Services;

public class SessionService
{
    private readonly AuthDbContext _db;
    private readonly IDbConnection _connection;

    public SessionService(AuthDbContext db, IDbConnection connection)
    {
        _db = db;
        _connection = connection;
    }

    public async Task PurgeExpiredAsync()
    {
        await _db.Sessions.Where(s => s.ExpiresAt < DateTime.UtcNow).ExecuteDeleteAsync();
    }

    public void PurgeOldLogs(DateTime cutoff)
    {
        _connection.Execute("DELETE FROM audit_logs WHERE created_at < @cutoff", new { cutoff });
    }
}
`, 'database/deterministic/unsafe-delete-without-where')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// database/deterministic/missing-migration
// ---------------------------------------------------------------------------

describe('database/deterministic/missing-migration (C#)', () => {
  it('detects ALTER TABLE outside a migration file', () => {
    const found = matches(`using System.Data;
using Dapper;

namespace Billing.Services;

public class InvoiceService
{
    public void EnableRegions(IDbConnection connection)
    {
        connection.Execute("ALTER TABLE invoices ADD COLUMN region text");
    }
}
`, 'database/deterministic/missing-migration')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag DDL inside a migration file', () => {
    const found = matches(`using System.Data;
using Dapper;

namespace Billing.Migrations;

public class AddRegionColumn
{
    public void Up(IDbConnection connection)
    {
        connection.Execute("ALTER TABLE invoices ADD COLUMN region text");
    }
}
`, 'database/deterministic/missing-migration', '/src/Migrations/20240612093000_AddRegionColumn.cs')
    expect(found).toHaveLength(0)
  })

  it('does not flag idempotent bootstrap DDL (CREATE TABLE IF NOT EXISTS)', () => {
    const found = matches(`using Microsoft.Data.Sqlite;

namespace Agent.Storage;

public class LocalCache
{
    public void EnsureSchema(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "CREATE TABLE IF NOT EXISTS cache_entries (key TEXT PRIMARY KEY, value TEXT)";
        cmd.ExecuteNonQuery();
    }
}
`, 'database/deterministic/missing-migration')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// database/deterministic/connection-not-released
// ---------------------------------------------------------------------------

describe('database/deterministic/connection-not-released (C#)', () => {
  it('detects Open() on a connection with no using/try-finally', () => {
    const found = matches(`using Microsoft.Data.SqlClient;

namespace Billing.Reports;

public class RevenueReport
{
    public decimal TotalRevenue(string connectionString)
    {
        var conn = new SqlConnection(connectionString);
        conn.Open();
        using var cmd = new SqlCommand("SELECT SUM(total) FROM invoices", conn);
        return (decimal)cmd.ExecuteScalar();
    }
}
`, 'database/deterministic/connection-not-released')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects a pooled OpenConnectionAsync not declared with using', () => {
    const found = matches(`using System.Threading.Tasks;
using Npgsql;

namespace Telemetry;

public class MetricsCollector
{
    private readonly NpgsqlDataSource _dataSource;

    public MetricsCollector(NpgsqlDataSource dataSource) => _dataSource = dataSource;

    public async Task<long> CountEventsAsync()
    {
        var conn = await _dataSource.OpenConnectionAsync();
        await using var cmd = new NpgsqlCommand("SELECT count(1) FROM events", conn);
        return (long)await cmd.ExecuteScalarAsync();
    }
}
`, 'database/deterministic/connection-not-released')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag using declarations or try/finally disposal', () => {
    const found = matches(`using System.Threading.Tasks;
using Microsoft.Data.SqlClient;
using Npgsql;

namespace Billing.Reports;

public class RevenueReport
{
    private readonly NpgsqlDataSource _dataSource;

    public RevenueReport(NpgsqlDataSource dataSource) => _dataSource = dataSource;

    public decimal TotalRevenue(string connectionString)
    {
        using var conn = new SqlConnection(connectionString);
        conn.Open();
        using var cmd = new SqlCommand("SELECT SUM(total) FROM invoices", conn);
        return (decimal)cmd.ExecuteScalar();
    }

    public decimal LegacyTotalRevenue(string connectionString)
    {
        var conn = new SqlConnection(connectionString);
        try
        {
            conn.Open();
            using var cmd = new SqlCommand("SELECT SUM(total) FROM invoices", conn);
            return (decimal)cmd.ExecuteScalar();
        }
        finally
        {
            conn.Dispose();
        }
    }

    public async Task<long> CountEventsAsync()
    {
        await using var conn = await _dataSource.OpenConnectionAsync();
        await using var cmd = new NpgsqlCommand("SELECT count(1) FROM events", conn);
        return (long)await cmd.ExecuteScalarAsync();
    }

    public int CountInvoices(string connectionString)
    {
        using (var conn = new SqlConnection(connectionString))
        {
            conn.Open();
            using var cmd = new SqlCommand("SELECT COUNT(1) FROM invoices", conn);
            return (int)cmd.ExecuteScalar();
        }
    }
}
`, 'database/deterministic/connection-not-released')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// database/deterministic/missing-transaction
// ---------------------------------------------------------------------------

describe('database/deterministic/missing-transaction (C#)', () => {
  it('detects two EF SaveChangesAsync round trips without a transaction', () => {
    const found = matches(`using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;

namespace Banking.Services;

public class TransferService
{
    private readonly BankContext _db;

    public TransferService(BankContext db) => _db = db;

    public async Task TransferAsync(int sourceId, int targetId, decimal amount)
    {
        var source = await _db.Accounts.FindAsync(sourceId);
        source.Balance -= amount;
        await _db.SaveChangesAsync();

        var target = await _db.Accounts.FindAsync(targetId);
        target.Balance += amount;
        await _db.SaveChangesAsync();
    }
}
`, 'database/deterministic/missing-transaction')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects two Dapper INSERT executions without a transaction', () => {
    const found = matches(`using System.Data;
using System.Threading.Tasks;
using Dapper;

namespace Shop.Repositories;

public class OrderWriter
{
    private readonly IDbConnection _connection;

    public OrderWriter(IDbConnection connection) => _connection = connection;

    public async Task CreateAsync(Order order)
    {
        await _connection.ExecuteAsync(
            "INSERT INTO orders (id, customer_id, total) VALUES (@Id, @CustomerId, @Total)", order);
        await _connection.ExecuteAsync(
            "INSERT INTO order_items (order_id, sku, qty) VALUES (@OrderId, @Sku, @Qty)", order.Items);
    }
}
`, 'database/deterministic/missing-transaction')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag writes wrapped in BeginTransaction', () => {
    const found = matches(`using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;

namespace Banking.Services;

public class TransferService
{
    private readonly BankContext _db;

    public TransferService(BankContext db) => _db = db;

    public async Task TransferAsync(int sourceId, int targetId, decimal amount)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();

        var source = await _db.Accounts.FindAsync(sourceId);
        source.Balance -= amount;
        await _db.SaveChangesAsync();

        var target = await _db.Accounts.FindAsync(targetId);
        target.Balance += amount;
        await _db.SaveChangesAsync();

        await tx.CommitAsync();
    }
}
`, 'database/deterministic/missing-transaction')
    expect(found).toHaveLength(0)
  })

  it('does not flag a single staged write with one SaveChanges', () => {
    const found = matches(`using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;

namespace Banking.Services;

public class AccountService
{
    private readonly BankContext _db;

    public AccountService(BankContext db) => _db = db;

    public async Task AddAccountAsync(Account account)
    {
        _db.Accounts.Add(account);
        await _db.SaveChangesAsync();
    }
}
`, 'database/deterministic/missing-transaction')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// database/deterministic/orm-lazy-load-in-loop
// ---------------------------------------------------------------------------

describe('database/deterministic/orm-lazy-load-in-loop (C#)', () => {
  it('detects a navigation-property materializer inside a foreach over a query result', () => {
    const found = matches(`using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;

namespace Shop.Reports;

public class OrderReport
{
    private readonly ShopContext _db;

    public OrderReport(ShopContext db) => _db = db;

    public async Task<List<string>> BuildAsync()
    {
        var lines = new List<string>();
        var orders = await _db.Orders.ToListAsync();
        foreach (var order in orders)
        {
            var itemCount = order.Items.Count();
            lines.Add($"{order.Id}: {itemCount}");
        }
        return lines;
    }
}
`, 'database/deterministic/orm-lazy-load-in-loop')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects a context query executed inside a loop', () => {
    const found = matches(`using System.Collections.Generic;
using System.Linq;
using Microsoft.EntityFrameworkCore;

namespace Crm.Services;

public class CustomerLoader
{
    private readonly CrmContext _db;

    public CustomerLoader(CrmContext db) => _db = db;

    public List<Customer> LoadCustomers(IEnumerable<int> ids)
    {
        var customers = new List<Customer>();
        foreach (var id in ids)
        {
            customers.Add(_db.Customers.First(c => c.Id == id));
        }
        return customers;
    }
}
`, 'database/deterministic/orm-lazy-load-in-loop')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects explicit Entry(...).Collection(...).Load() inside a loop', () => {
    const found = matches(`using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;

namespace Shop.Services;

public class OrderHydrator
{
    private readonly ShopContext _db;

    public OrderHydrator(ShopContext db) => _db = db;

    public async Task HydrateAsync()
    {
        var orders = await _db.Orders.ToListAsync();
        foreach (var order in orders)
        {
            _db.Entry(order).Collection(o => o.Items).Load();
        }
    }
}
`, 'database/deterministic/orm-lazy-load-in-loop')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag navigations on an eagerly loaded (.Include) source', () => {
    const found = matches(`using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;

namespace Shop.Reports;

public class OrderReport
{
    private readonly ShopContext _db;

    public OrderReport(ShopContext db) => _db = db;

    public async Task<int> TotalItemsAsync()
    {
        var total = 0;
        var orders = await _db.Orders.Include(o => o.Items).ToListAsync();
        foreach (var order in orders)
        {
            total += order.Items.Count();
        }
        return total;
    }
}
`, 'database/deterministic/orm-lazy-load-in-loop')
    expect(found).toHaveLength(0)
  })

  it('does not flag materializers over an in-memory collection in an EF Core file', () => {
    const found = matches(`using System.Collections.Generic;
using System.Linq;
using Microsoft.EntityFrameworkCore;

namespace Shop.Pricing;

public class PriceCalculator
{
    private readonly ShopContext _db;

    public PriceCalculator(ShopContext db) => _db = db;

    public decimal Total(Order order)
    {
        var bundles = new List<Bundle> { Bundle.Standard, Bundle.Premium };
        var total = 0m;
        foreach (var bundle in bundles)
        {
            total += bundle.Components.Sum(c => c.Price);
        }
        return total;
    }
}
`, 'database/deterministic/orm-lazy-load-in-loop')
    expect(found).toHaveLength(0)
  })

  it('does not flag plain LINQ-to-objects in a file without an ORM', () => {
    const found = matches(`using System.Collections.Generic;
using System.Linq;

namespace Blog.Formatting;

public class TagFormatter
{
    public List<string> Format(List<Post> posts)
    {
        var result = new List<string>();
        foreach (var post in posts)
        {
            result.Add(string.Join(",", post.Tags.ToList()));
        }
        return result;
    }
}
`, 'database/deterministic/orm-lazy-load-in-loop')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// database/deterministic/unvalidated-external-data
// ---------------------------------------------------------------------------

describe('database/deterministic/unvalidated-external-data (C#)', () => {
  it('detects raw Request.Form data written through EF Core', () => {
    const found = matches(`using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Crm.Controllers;

[ApiController]
[Route("api/leads")]
public class LeadsController : ControllerBase
{
    private readonly CrmContext _db;

    public LeadsController(CrmContext db) => _db = db;

    [HttpPost]
    public async Task<IActionResult> Create()
    {
        _db.Leads.Add(new Lead
        {
            Email = Request.Form["email"],
            Source = Request.Form["source"],
        });
        await _db.SaveChangesAsync();
        return Ok();
    }
}
`, 'database/deterministic/unvalidated-external-data')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects raw Request.Query data passed to a Dapper write', () => {
    const found = matches(`using System.Data;
using System.Threading.Tasks;
using Dapper;
using Microsoft.AspNetCore.Mvc;

namespace Crm.Controllers;

[ApiController]
[Route("api/leads")]
public class LeadsController : ControllerBase
{
    private readonly IDbConnection _connection;

    public LeadsController(IDbConnection connection) => _connection = connection;

    [HttpPost]
    public async Task<IActionResult> Tag()
    {
        await _connection.ExecuteAsync(
            "INSERT INTO lead_tags (lead_id, tag) VALUES (@leadId, @tag)",
            new { leadId = Request.Query["leadId"], tag = Request.Query["tag"] });
        return Ok();
    }
}
`, 'database/deterministic/unvalidated-external-data')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag model-bound DTOs or non-database collection adds', () => {
    const found = matches(`using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Crm.Controllers;

[ApiController]
[Route("api/leads")]
public class LeadsController : ControllerBase
{
    private readonly CrmContext _db;

    public LeadsController(CrmContext db) => _db = db;

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateLeadRequest request)
    {
        _db.Leads.Add(new Lead { Email = request.Email, Source = request.Source });
        await _db.SaveChangesAsync();
        return Ok();
    }

    [HttpGet("search")]
    public IActionResult Search()
    {
        var terms = new List<string>();
        terms.Add(Request.Query["q"]);
        return Ok(terms);
    }
}
`, 'database/deterministic/unvalidated-external-data')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// database/deterministic/datetime-primary-key
// ---------------------------------------------------------------------------

describe('database/deterministic/datetime-primary-key (C#)', () => {
  it('detects a [Key]-attributed DateTime primary key', () => {
    const found = matches(`using System;
using System.ComponentModel.DataAnnotations;

namespace Telemetry.Domain;

public class Reading
{
    [Key]
    public DateTime CapturedAt { get; set; }

    public double Value { get; set; }
}
`, 'database/deterministic/datetime-primary-key')
    expect(found).toHaveLength(1)
  })

  it('detects a by-convention Id property typed DateTimeOffset', () => {
    const found = matches(`using System;

namespace Audit.Domain;

public class AuditEvent
{
    public DateTimeOffset Id { get; set; }

    public string Action { get; set; } = string.Empty;
}
`, 'database/deterministic/datetime-primary-key')
    expect(found).toHaveLength(1)
  })

  it('detects a <ClassName>Id convention key typed System.DateTime', () => {
    const found = matches(`namespace Sales.Domain;

public class Snapshot
{
    public System.DateTime SnapshotId { get; set; }

    public decimal Total { get; set; }
}
`, 'database/deterministic/datetime-primary-key')
    expect(found).toHaveLength(1)
  })

  it('detects a nullable DateTime? primary key', () => {
    const found = matches(`using System;
using System.ComponentModel.DataAnnotations;

namespace Ops.Domain;

public class Job
{
    [Key]
    public DateTime? ScheduledFor { get; set; }
}
`, 'database/deterministic/datetime-primary-key')
    expect(found).toHaveLength(1)
  })

  it('does not flag a surrogate key with a timestamp column', () => {
    const found = matches(`using System;

namespace Telemetry.Domain;

public class Reading
{
    public long Id { get; set; }

    public DateTime CapturedAt { get; set; }

    public double Value { get; set; }
}
`, 'database/deterministic/datetime-primary-key')
    expect(found).toHaveLength(0)
  })

  it('does not flag a DateTime property that is not the primary key', () => {
    const found = matches(`using System;

namespace Telemetry.Domain;

public class Reading
{
    public Guid Id { get; set; }

    public DateTime CapturedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
`, 'database/deterministic/datetime-primary-key')
    expect(found).toHaveLength(0)
  })

  it('does not flag a non-temporal [Key] primary key', () => {
    const found = matches(`using System;
using System.ComponentModel.DataAnnotations;

namespace Telemetry.Domain;

public class Device
{
    [Key]
    public Guid DeviceId { get; set; }

    public DateTime LastSeen { get; set; }
}
`, 'database/deterministic/datetime-primary-key')
    expect(found).toHaveLength(0)
  })
})
