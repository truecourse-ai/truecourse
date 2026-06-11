import { describe, it, expect } from 'vitest'
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker'
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index'
import { parseCode } from '../../packages/analyzer/src/parser'

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled)

function check(code: string) {
  const tree = parseCode(code, 'csharp')
  return checkCodeRules(tree, '/test/OrderService.cs', code, enabledRules, 'csharp')
}

// ---------------------------------------------------------------------------
// style/deterministic/comment-tag-formatting
// ---------------------------------------------------------------------------

describe('style/deterministic/comment-tag-formatting (C#)', () => {
  it('detects a TODO comment without a colon', () => {
    const violations = check(`namespace Ordering;

public class OrderDispatcher
{
    public void Dispatch(Order order)
    {
        // TODO add retry with exponential backoff
        _queue.Publish(order);
    }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/comment-tag-formatting')
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(matches[0]!.title).toContain('TODO')
  })

  it('detects an empty FIXME comment', () => {
    const violations = check(`namespace Ordering;

public class OrderDispatcher
{
    public void Dispatch(Order order)
    {
        // FIXME
        _queue.Publish(order);
    }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/comment-tag-formatting')
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(matches[0]!.title).toContain('FIXME')
  })

  it('does not flag well-formed TODO/FIXME comments', () => {
    const violations = check(`namespace Ordering;

public class OrderDispatcher
{
    public void Dispatch(Order order)
    {
        // TODO: retry transient publish failures with exponential backoff
        /* FIXME: dead-letter malformed payloads from the legacy queue */
        _queue.Publish(order);
    }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/comment-tag-formatting')
    expect(matches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// style/deterministic/whitespace-formatting
// ---------------------------------------------------------------------------

describe('style/deterministic/whitespace-formatting (C#)', () => {
  it('detects mixed tabs and spaces', () => {
    const violations = check(
      'namespace Ordering;\n' +
      'public class StockChecker\n' +
      '{\n' +
      '\tpublic bool IsInStock(int sku)\n' +
      '\t{\n' +
      '        return _inventory.Count(sku) > 0;\n' +
      '\t}\n' +
      '}\n'
    )
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/whitespace-formatting')
    expect(matches).toHaveLength(1)
  })

  it('does not flag consistent space indentation', () => {
    const violations = check(`namespace Ordering;
public class StockChecker
{
    public bool IsInStock(int sku)
    {
        return _inventory.Count(sku) > 0;
    }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/whitespace-formatting')
    expect(matches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// style/deterministic/unnecessary-parentheses-style
// ---------------------------------------------------------------------------

describe('style/deterministic/unnecessary-parentheses-style (C#)', () => {
  it('detects unnecessary parentheses around a return value', () => {
    const violations = check(`namespace Billing;

public class InvoiceCalculator
{
    public decimal CalculateTotal(IEnumerable<OrderLine> lines)
    {
        var total = lines.Sum(l => l.UnitPrice * l.Quantity);
        return (total);
    }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/unnecessary-parentheses-style')
    expect(matches).toHaveLength(1)
    expect(matches[0]!.content).toContain('return total;')
  })

  it('detects unnecessary parentheses around a thrown exception', () => {
    const violations = check(`namespace Billing;

public class InvoiceLoader
{
    public Invoice Load(int id)
    {
        var invoice = _repository.Find(id);
        if (invoice == null)
        {
            throw (new InvalidOperationException($"Invoice {id} not found"));
        }
        return invoice;
    }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/unnecessary-parentheses-style')
    expect(matches).toHaveLength(1)
    expect(matches[0]!.title).toContain('throw')
  })

  it('does not flag plain returns, tuples, casts, or compound expressions', () => {
    const violations = check(`namespace Billing;

public class InvoiceCalculator
{
    public decimal CalculateTotal(IEnumerable<OrderLine> lines)
    {
        var total = lines.Sum(l => l.UnitPrice * l.Quantity);
        return total;
    }

    public (decimal Subtotal, decimal Tax) Breakdown(decimal subtotal, decimal tax)
    {
        return (subtotal, tax);
    }

    public decimal ToUnitTotal(int units, object unitPrice)
    {
        return (decimal)(unitPrice);
    }

    public string ResolveCurrency(string requested, string fallback)
    {
        return (requested ?? fallback);
    }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/unnecessary-parentheses-style')
    expect(matches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// style/deterministic/sorting-style
// ---------------------------------------------------------------------------

describe('style/deterministic/sorting-style (C#)', () => {
  it('detects using directives sorted under neither convention', () => {
    const violations = check(`using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using System.Net.Http;

namespace Ordering.Api;

public class OrdersController : ControllerBase { }
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/sorting-style')
    expect(matches).toHaveLength(1)
  })

  it('does not flag alphabetically sorted using directives', () => {
    const violations = check(`using Microsoft.AspNetCore.Mvc;
using System.Net.Http;
using System.Text.Json;

namespace Ordering.Api;

public class OrdersController : ControllerBase { }
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/sorting-style')
    expect(matches).toHaveLength(0)
  })

  it('does not flag System-first ordering', () => {
    const violations = check(`using System;
using System.Net.Http;
using Microsoft.Extensions.Logging;

namespace Ordering.Workers;

public class StockSyncWorker { }
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/sorting-style')
    expect(matches).toHaveLength(0)
  })

  it('treats blank lines as group boundaries', () => {
    const violations = check(`using System.Net.Http;
using System.Text.Json;

using Microsoft.Extensions.Logging;
using Polly;

namespace Ordering.Workers;

public class StockSyncWorker { }
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/sorting-style')
    expect(matches).toHaveLength(0)
  })

  it('excludes alias and static usings from the ordering check', () => {
    const violations = check(`using Serilog;
using Json = System.Text.Json.JsonSerializer;
using Microsoft.Extensions.Logging;
using static System.Math;

namespace Ordering.Workers;

public class StockSyncWorker { }
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/sorting-style')
    expect(matches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// style/deterministic/docstring-completeness
// ---------------------------------------------------------------------------

describe('style/deterministic/docstring-completeness (C#)', () => {
  it('detects a public class and method without XML doc comments', () => {
    const violations = check(`namespace Billing;

public class InvoiceCalculator
{
    public decimal Calculate(Invoice invoice)
    {
        return invoice.Lines.Sum(l => l.Amount);
    }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/docstring-completeness')
    expect(matches).toHaveLength(2)
    expect(matches.map((m) => m.title).sort()).toEqual(['Class missing doc comment', 'Method missing doc comment'])
  })

  it('does not flag documented, non-public, override, or test members', () => {
    const violations = check(`namespace Billing;

/// <summary>Computes invoice totals including tax.</summary>
public class InvoiceCalculator
{
    /// <summary>Sums all line amounts.</summary>
    public decimal Calculate(Invoice invoice) => invoice.Lines.Sum(l => l.Amount);

    internal decimal ApplyTax(decimal amount) => amount * 1.2m;

    public override string ToString() => nameof(InvoiceCalculator);
}

public class InvoiceCalculatorTests
{
    [Fact]
    public void Calculate_SumsLineAmounts()
    {
        var calculator = new InvoiceCalculator();
        Assert.Equal(0m, calculator.Calculate(new Invoice()));
    }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/docstring-completeness')
    expect(matches).toHaveLength(0)
  })

  it('does not flag auto-generated files or EF Core migrations', () => {
    const violations = check(`// <auto-generated />
namespace Billing.Migrations;

public partial class AddInvoiceTable : Migration
{
    public void Up(MigrationBuilder migrationBuilder) { }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/docstring-completeness')
    expect(matches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// style/deterministic/csharp-naming-convention (C# port: .NET naming conventions)
// ---------------------------------------------------------------------------

describe('style/deterministic/csharp-naming-convention (C#: .NET naming)', () => {
  it('detects names violating .NET conventions', () => {
    const violations = check(`namespace Ordering;

public interface OrderRepository
{
    Task<Order> FindAsync(int id);
}

public class order_service
{
    public int maxRetries = 3;
    private const string apiKey = "secret";
    private int retry_count;

    public string connectionString { get; set; }

    public async Task processOrder(int id)
    {
        retry_count++;
    }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/csharp-naming-convention')
    const titles = matches.map((m) => m.title).sort()
    expect(titles).toEqual([
      'Constant not in PascalCase',
      'Field uses snake_case',
      'Interface missing I prefix',
      'Method not in PascalCase',
      'Property not in PascalCase',
      'Public field not in PascalCase',
      'Type not in PascalCase',
    ])
  })

  it('does not flag conventional .NET code, test names, or interop signatures', () => {
    const violations = check(`namespace Ordering;

public interface IOrderRepository
{
    Task<Order> FindAsync(int id);
}

public class OrderService : IDisposable
{
    public const int MaxRetries = 3;
    private readonly HttpClient _httpClient;
    private int requestCount;

    public string ConnectionString { get; set; }

    public async Task ProcessOrderAsync(int id)
    {
        requestCount++;
    }

    void IDisposable.Dispose() => _httpClient.Dispose();

    [DllImport("msvcrt.dll", EntryPoint = "memcpy")]
    private static extern IntPtr memcpy(IntPtr dest, IntPtr src, UIntPtr count);
}

public class OrderServiceTests
{
    [Fact]
    public void ProcessOrder_WhenIdMissing_Throws()
    {
        Assert.ThrowsAsync<KeyNotFoundException>(() => new OrderService().ProcessOrderAsync(-1));
    }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/csharp-naming-convention')
    expect(matches).toHaveLength(0)
  })

  it('does not flag WinForms-style event handler names', () => {
    const violations = check(`namespace Ordering.Desktop;

public partial class OrdersForm
{
    private void saveButton_Click(object sender, EventArgs e)
    {
        _presenter.SaveCurrentOrder();
    }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'style/deterministic/csharp-naming-convention')
    expect(matches).toHaveLength(0)
  })
})
