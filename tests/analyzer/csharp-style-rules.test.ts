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

// ---------------------------------------------------------------------------
// style/deterministic/builtin-type-alias (SA1121)
// ---------------------------------------------------------------------------

describe('style/deterministic/builtin-type-alias (C#)', () => {
  const KEY = 'style/deterministic/builtin-type-alias'

  it('flags framework type names in type positions', () => {
    const violations = check(`namespace Billing;

internal sealed class LedgerEntry
{
    private Int32 _sequence;
    private readonly List<String> _tags = new();

    internal Object Project(String key, Int64 count) => null!;

    internal Decimal[] Buckets;
}
`)
    const matches = violations.filter((v) => v.ruleKey === KEY)
    // Int32, String (generic arg), Object, String (param), Int64, Decimal (array)
    expect(matches.length).toBe(6)
    expect(matches.every((m) => m.content.includes('alias'))).toBe(true)
  })

  it('does not flag the language aliases or value/reflection references', () => {
    const violations = check(`namespace Billing;

internal sealed class LedgerEntry
{
    private int _sequence;
    private readonly List<string> _tags = new();

    internal object Project(string key, long count)
    {
        var blank = String.Empty;
        var named = nameof(Int32);
        var reflected = typeof(Boolean);
        var fallback = default(Int64);
        return blank;
    }
}
`)
    const matches = violations.filter((v) => v.ruleKey === KEY)
    expect(matches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// style/deterministic/enum-name-redundant-suffix (S2344)
// ---------------------------------------------------------------------------

describe('style/deterministic/enum-name-redundant-suffix (C#)', () => {
  const KEY = 'style/deterministic/enum-name-redundant-suffix'

  it('flags a Flags enum whose name ends in Flags or Enum', () => {
    const flags = check(`namespace Access;

[Flags]
internal enum PermissionFlags
{
    None = 0,
    Read = 1,
}
`)
    expect(flags.filter((v) => v.ruleKey === KEY)).toHaveLength(1)

    const enumSuffix = check(`namespace Access;

[Flags]
internal enum PermissionEnum
{
    None = 0,
    Read = 1,
}
`)
    expect(enumSuffix.filter((v) => v.ruleKey === KEY)).toHaveLength(1)
  })

  it('does not flag a well-named Flags enum or a non-Flags enum', () => {
    const wellNamed = check(`namespace Access;

[Flags]
internal enum Permission
{
    None = 0,
    Read = 1,
}

internal enum OrderStatusEnum
{
    Pending,
    Shipped,
}
`)
    expect(wellNamed.filter((v) => v.ruleKey === KEY)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// style/deterministic/enum-naming-convention (S2342)
// ---------------------------------------------------------------------------

describe('style/deterministic/enum-naming-convention (C#)', () => {
  const KEY = 'style/deterministic/enum-naming-convention'

  it('flags Flags enum members not in PascalCase', () => {
    const violations = check(`namespace Access;

[Flags]
internal enum Permission
{
    None = 0,
    read_only = 1,
    Write = 2,
}
`)
    const matches = violations.filter((v) => v.ruleKey === KEY)
    expect(matches).toHaveLength(1)
    expect(matches[0]!.content).toContain('read_only')
  })

  it('does not flag PascalCase Flags members', () => {
    const violations = check(`namespace Access;

[Flags]
internal enum Permission
{
    None = 0,
    ReadOnly = 1,
    Write = 2,
}
`)
    expect(violations.filter((v) => v.ruleKey === KEY)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// style/deterministic/flags-enum-zero-not-none (S2346)
// ---------------------------------------------------------------------------

describe('style/deterministic/flags-enum-zero-not-none (C#)', () => {
  const KEY = 'style/deterministic/flags-enum-zero-not-none'

  it('flags a Flags enum whose 0 value is not named None', () => {
    const violations = check(`namespace Access;

[Flags]
internal enum Permission
{
    Default = 0,
    Read = 1,
    Write = 2,
}
`)
    const matches = violations.filter((v) => v.ruleKey === KEY)
    expect(matches).toHaveLength(1)
    expect(matches[0]!.content).toContain('Default')
  })

  it('does not flag a Flags enum whose 0 value is None', () => {
    const violations = check(`namespace Access;

[Flags]
internal enum Permission
{
    None = 0,
    Read = 1,
    Write = 2,
}
`)
    expect(violations.filter((v) => v.ruleKey === KEY)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// style/deterministic/field-keyword-conflict (S8367)
// ---------------------------------------------------------------------------

describe('style/deterministic/field-keyword-conflict (C#)', () => {
  const KEY = 'style/deterministic/field-keyword-conflict'

  it('flags a type member named field', () => {
    const violations = check(`namespace Forms;

internal sealed class Renderer
{
    private int field;

    internal void Bind(int field)
    {
        this.field = field;
    }
}
`)
    const matches = violations.filter((v) => v.ruleKey === KEY)
    // only the field MEMBER; the parameter and the member-access references
    // (this.field) are out of scope.
    expect(matches).toHaveLength(1)
  })

  it('does not flag parameters, locals, or references named field', () => {
    const violations = check(`namespace Forms;

internal sealed class Renderer
{
    internal int Compute(Form form)
    {
        var field = form.Width;
        return field + form.field;
    }
}
`)
    expect(violations.filter((v) => v.ruleKey === KEY)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// style/deterministic/logger-field-naming (S6669)
// ---------------------------------------------------------------------------

describe('style/deterministic/logger-field-naming (C#)', () => {
  const KEY = 'style/deterministic/logger-field-naming'

  it('flags logger fields/properties not following the convention', () => {
    const violations = check(`namespace Ordering;

internal sealed class OrderProcessor
{
    private readonly ILogger Logger;
    public ILogger<OrderProcessor> AuditLog { get; }
}
`)
    expect(violations.filter((v) => v.ruleKey === KEY)).toHaveLength(2)
  })

  it('does not flag conventionally named loggers or non-logger fields', () => {
    const violations = check(`namespace Ordering;

internal sealed class OrderProcessor
{
    private readonly ILogger _logger;
    private readonly ILogger<OrderProcessor> logger2;
    private readonly ILoggerFactory LoggerFactory;
    private readonly HttpClient Client;
}
`)
    expect(violations.filter((v) => v.ruleKey === KEY)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// style/deterministic/scoped-identifier-escape (S8381)
// ---------------------------------------------------------------------------

describe('style/deterministic/scoped-identifier-escape (C#)', () => {
  const KEY = 'style/deterministic/scoped-identifier-escape'

  it('flags scoped used as an untyped parenthesized lambda parameter', () => {
    const violations = check(`namespace Pipelines;

internal sealed class Stage
{
    internal void Wire()
    {
        Func<int, int> increment = (scoped) => scoped + 1;
        Run(increment);
    }
}
`)
    expect(violations.filter((v) => v.ruleKey === KEY)).toHaveLength(1)
  })

  it('does not flag typed lambda params, method params, or escaped names', () => {
    const violations = check(`namespace Pipelines;

internal sealed class Stage
{
    internal void Wire(int scoped)
    {
        Func<int, int> a = (int scoped) => scoped + 1;
        Func<int, int> b = @scoped => @scoped + 1;
        Run(a, b);
    }
}
`)
    expect(violations.filter((v) => v.ruleKey === KEY)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// style/deterministic/type-name-suffix-convention (S3376 / CA1710 / CA1711)
// ---------------------------------------------------------------------------

describe('style/deterministic/type-name-suffix-convention (C#)', () => {
  const KEY = 'style/deterministic/type-name-suffix-convention'

  it('flags types deriving from framework bases without the matching suffix', () => {
    const violations = check(`namespace Domain;

internal sealed class PaymentFailed : Exception { }

internal sealed class OrderPlaced : EventArgs { }

internal sealed class Required : Attribute { }
`)
    const matches = violations.filter((v) => v.ruleKey === KEY)
    expect(matches).toHaveLength(3)
    expect(matches.map((m) => m.title).sort()).toEqual([
      "Type should end with 'Attribute'",
      "Type should end with 'EventArgs'",
      "Type should end with 'Exception'",
    ])
  })

  it('does not flag types that already carry the suffix', () => {
    const violations = check(`namespace Domain;

internal sealed class PaymentFailedException : Exception { }

internal sealed class OrderPlacedEventArgs : EventArgs { }

internal sealed class RequiredAttribute : Attribute { }
`)
    expect(violations.filter((v) => v.ruleKey === KEY)).toHaveLength(0)
  })
})
