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
  return check(code).filter((v) => v.ruleKey === `code-quality/deterministic/${ruleKey}`)
}

// ---------------------------------------------------------------------------
// cognitive-complexity
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/cognitive-complexity (C#)', () => {
  it('detects deeply nested control flow', () => {
    const found = matches(`namespace App;
public class FulfillmentService
{
    public async Task ProcessBatchAsync(List<Order> orders)
    {
        foreach (var order in orders)
        {
            if (order.Lines == null)
            {
                continue;
            }
            if (order.Status == OrderStatus.Pending && order.Total > 0)
            {
                foreach (var line in order.Lines)
                {
                    if (line.Quantity > 0 || line.IsBackordered)
                    {
                        try
                        {
                            await ShipLineAsync(line);
                        }
                        catch (ShippingException ex)
                        {
                            if (ex.Retryable)
                            {
                                _retryQueue.Enqueue(line);
                            }
                        }
                    }
                }
            }
        }
    }
}
`, 'cognitive-complexity')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag idiomatic LINQ chains', () => {
    const found = matches(`namespace App;
public class OrderQueries
{
    public List<OrderSummary> ActiveSummaries(IEnumerable<Order> orders, decimal minTotal)
    {
        return orders
            .Where(o => o.Status == OrderStatus.Active && o.Total >= minTotal)
            .OrderByDescending(o => o.Total)
            .Select(o => new OrderSummary { Id = o.Id, Total = o.Total })
            .ToList();
    }
}
`, 'cognitive-complexity')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// cyclomatic-complexity / too-many-branches
// ---------------------------------------------------------------------------

const manyIfsValidator = `namespace App;
public class ProfileValidator
{
    public List<string> Validate(UserProfile p)
    {
        var errors = new List<string>();
        if (string.IsNullOrEmpty(p.FirstName)) errors.Add("first name is required");
        if (string.IsNullOrEmpty(p.LastName)) errors.Add("last name is required");
        if (string.IsNullOrEmpty(p.Email)) errors.Add("email is required");
        if (p.Email != null && !p.Email.Contains('@')) errors.Add("email is invalid");
        if (p.Age < 0) errors.Add("age cannot be negative");
        if (p.Age > 150) errors.Add("age is implausible");
        if (string.IsNullOrEmpty(p.Country)) errors.Add("country is required");
        if (string.IsNullOrEmpty(p.PostalCode)) errors.Add("postal code is required");
        if (p.Phone != null && p.Phone.Length < 7) errors.Add("phone number is too short");
        if (p.Website != null && !p.Website.StartsWith("https://")) errors.Add("website must be https");
        if (p.DisplayName != null && p.DisplayName.Length > 64) errors.Add("display name is too long");
        return errors;
    }
}
`

const bigSwitchExpression = `namespace App;
public static class StatusLabels
{
    public static string ToLabel(OrderStatus status) => status switch
    {
        OrderStatus.Draft => "Draft",
        OrderStatus.Pending => "Pending approval",
        OrderStatus.Approved => "Approved",
        OrderStatus.Picking => "Being picked",
        OrderStatus.Packed => "Packed",
        OrderStatus.Shipped => "Shipped",
        OrderStatus.InTransit => "In transit",
        OrderStatus.Delivered => "Delivered",
        OrderStatus.Returned => "Returned",
        OrderStatus.Refunded => "Refunded",
        OrderStatus.Cancelled => "Cancelled",
        OrderStatus.OnHold => "On hold",
        _ => "Unknown",
    };
}
`

describe('code-quality/deterministic/cyclomatic-complexity (C#)', () => {
  it('detects a method with more than 10 decision points', () => {
    expect(matches(manyIfsValidator, 'cyclomatic-complexity').length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a switch expression mapper (pattern matching is idiomatic)', () => {
    expect(matches(bigSwitchExpression, 'cyclomatic-complexity')).toHaveLength(0)
  })
})

describe('code-quality/deterministic/too-many-branches (C#)', () => {
  it('detects a method with more than 10 branches', () => {
    expect(matches(manyIfsValidator, 'too-many-branches').length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a switch expression mapper', () => {
    expect(matches(bigSwitchExpression, 'too-many-branches')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// max-nesting-depth
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/max-nesting-depth (C#)', () => {
  it('detects a block nested five levels deep', () => {
    const found = matches(`namespace App;
public class LedgerReconciler
{
    public void Reconcile(List<Account> accounts)
    {
        foreach (var account in accounts)
        {
            if (account.IsActive)
            {
                foreach (var tx in account.Transactions)
                {
                    if (tx.Amount > 0)
                    {
                        if (tx.Currency == "USD")
                        {
                            Post(tx);
                        }
                    }
                }
            }
        }
    }
}
`, 'max-nesting-depth')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not count an else-if chain as nesting', () => {
    const found = matches(`namespace App;
public class DealSizer
{
    public string Categorize(decimal amount)
    {
        if (amount < 10)
        {
            return "micro";
        }
        else if (amount < 100)
        {
            return "small";
        }
        else if (amount < 1000)
        {
            return "medium";
        }
        else if (amount < 10000)
        {
            return "large";
        }
        else
        {
            return "enterprise";
        }
    }
}
`, 'max-nesting-depth')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// max-statements-per-function / too-many-lines
// ---------------------------------------------------------------------------

const longRegistrationMethod = `namespace App;
public static class ServiceRegistration
{
    public static void ConfigureServices(IServiceCollection services)
    {
${Array.from({ length: 52 }, (_, i) => `        services.AddScoped<IDomainHandler${i}, DomainHandler${i}>();`).join('\n')}
    }
}
`

const shortMethod = `namespace App;
public class GreetingService
{
    public string Greet(string name)
    {
        var trimmed = name.Trim();
        return $"Hello, {trimmed}!";
    }
}
`

describe('code-quality/deterministic/max-statements-per-function (C#)', () => {
  it('detects a method with more than 30 statements', () => {
    expect(matches(longRegistrationMethod, 'max-statements-per-function').length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a short method', () => {
    expect(matches(shortMethod, 'max-statements-per-function')).toHaveLength(0)
  })
})

describe('code-quality/deterministic/too-many-lines (C#)', () => {
  it('detects a method body longer than 50 lines', () => {
    expect(matches(longRegistrationMethod, 'too-many-lines').length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a short method', () => {
    expect(matches(shortMethod, 'too-many-lines')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// too-many-return-statements
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/too-many-return-statements (C#)', () => {
  it('detects a method with more than 5 returns', () => {
    const found = matches(`namespace App;
public class RegionResolver
{
    public string ResolveRegion(string code)
    {
        if (code == "us-east-1") return "US East";
        if (code == "us-west-2") return "US West";
        if (code == "eu-west-1") return "EU West";
        if (code == "eu-central-1") return "EU Central";
        if (code == "ap-south-1") return "AP South";
        if (code == "ap-northeast-1") return "AP Northeast";
        return code;
    }
}
`, 'too-many-return-statements')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not charge returns inside lambdas to the enclosing method', () => {
    const found = matches(`namespace App;
public class ScoreNormalizer
{
    public List<decimal> NormalizeAll(List<decimal> values)
    {
        if (values.Count == 0) return new List<decimal>();
        var normalized = values.Select(v =>
        {
            if (v < 0) return 0m;
            if (v > 1) return 1m;
            return v;
        }).ToList();
        return normalized;
    }
}
`, 'too-many-return-statements')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// too-many-breaks
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/too-many-breaks (C#)', () => {
  it('detects a loop with more than 5 breaks', () => {
    const found = matches(`namespace App;
public class DelimiterScanner
{
    public int FindDelimiter(string text)
    {
        var index = 0;
        while (index < text.Length)
        {
            var c = text[index];
            if (c == ';') break;
            if (c == ',') break;
            if (c == '|') break;
            if (c == '\\t') break;
            if (c == '\\n') break;
            if (c == '#') break;
            index++;
        }
        return index;
    }
}
`, 'too-many-breaks')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not count the mandatory breaks of switch sections', () => {
    const found = matches(`namespace App;
public class LifecycleDispatcher
{
    public void Dispatch(string phase, Deployment deployment)
    {
        switch (phase)
        {
            case "build":
                deployment.Build();
                break;
            case "test":
                deployment.RunTests();
                break;
            case "stage":
                deployment.Stage();
                break;
            case "deploy":
                deployment.Deploy();
                break;
            case "verify":
                deployment.Verify();
                break;
            case "finalize":
                deployment.Finalize();
                break;
            default:
                deployment.Skip(phase);
                break;
        }
    }
}
`, 'too-many-breaks')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// too-many-switch-cases
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/too-many-switch-cases (C#)', () => {
  it('detects a switch statement with more than 10 case sections', () => {
    const found = matches(`namespace App;
public class MimeTypeRouter
{
    public void Route(string extension, HttpResponse response)
    {
        switch (extension)
        {
            case ".html": response.ContentType = "text/html"; break;
            case ".css": response.ContentType = "text/css"; break;
            case ".js": response.ContentType = "text/javascript"; break;
            case ".json": response.ContentType = "application/json"; break;
            case ".png": response.ContentType = "image/png"; break;
            case ".jpg": response.ContentType = "image/jpeg"; break;
            case ".gif": response.ContentType = "image/gif"; break;
            case ".svg": response.ContentType = "image/svg+xml"; break;
            case ".pdf": response.ContentType = "application/pdf"; break;
            case ".zip": response.ContentType = "application/zip"; break;
            case ".txt": response.ContentType = "text/plain"; break;
            default: response.ContentType = "application/octet-stream"; break;
        }
    }
}
`, 'too-many-switch-cases')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a switch expression with many arms', () => {
    expect(matches(bigSwitchExpression, 'too-many-switch-cases')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// too-many-classes-per-file
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/too-many-classes-per-file (C#)', () => {
  it('detects a file with more than 3 classes', () => {
    const found = matches(`namespace App;
public class OrderCreatedHandler { public void Handle(OrderCreated e) => _bus.Publish(e); }
public class OrderShippedHandler { public void Handle(OrderShipped e) => _bus.Publish(e); }
public class OrderCancelledHandler { public void Handle(OrderCancelled e) => _bus.Publish(e); }
public class OrderRefundedHandler { public void Handle(OrderRefunded e) => _bus.Publish(e); }
`, 'too-many-classes-per-file')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not count records and enums grouped with a class', () => {
    const found = matches(`namespace App;
public enum ShipmentState { Pending, InTransit, Delivered }
public record ShipmentRequested(string OrderId, string Carrier);
public record ShipmentDelivered(string OrderId, DateTime At);
public record ShipmentLost(string OrderId, string Reason);
public class ShipmentTracker
{
    public ShipmentState Track(string orderId) => _store.GetState(orderId);
}
`, 'too-many-classes-per-file')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// too-many-locals
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/too-many-locals (C#)', () => {
  it('detects a method juggling more than 15 locals', () => {
    const found = matches(`namespace App;
public class InvoiceCalculator
{
    public InvoiceSummary Summarize(Order order, TaxTable taxes)
    {
        var subtotal = order.Lines.Sum(l => l.Price * l.Quantity);
        var discount = order.Coupon != null ? order.Coupon.Amount : 0m;
        var taxable = subtotal - discount;
        var stateTax = taxable * taxes.StateRate;
        var cityTax = taxable * taxes.CityRate;
        var totalTax = stateTax + cityTax;
        var shipping = order.Weight * taxes.ShippingRate;
        var insurance = order.DeclaredValue * taxes.InsuranceRate;
        var handling = order.Fragile ? taxes.HandlingFee : 0m;
        var fees = shipping + insurance + handling;
        var total = taxable + totalTax + fees;
        var rounded = Math.Round(total, 2);
        var currency = order.Currency;
        var formatted = currency + " " + rounded;
        return new InvoiceSummary { Total = rounded, Display = formatted };
    }
}
`, 'too-many-locals')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not count lambda-scoped variables against the method', () => {
    const found = matches(`namespace App;
public class TopCustomerQuery
{
    public List<string> TopSpenders(IEnumerable<Order> orders)
    {
        var byCustomer = orders.GroupBy(o => o.CustomerId).Select(g =>
        {
            var total = g.Sum(o => o.Total);
            var name = g.First().CustomerName;
            var count = g.Count();
            return new { name, total, count };
        });
        return byCustomer.OrderByDescending(c => c.total).Take(10).Select(c => c.name).ToList();
    }
}
`, 'too-many-locals')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// too-many-positional-arguments
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/too-many-positional-arguments (C#)', () => {
  it('detects a method with more than 5 parameters', () => {
    const found = matches(`namespace App;
public class ShipmentService
{
    public void RegisterShipment(string origin, string destination, decimal weight, decimal declaredValue, bool requiresSignature, DateTime pickupDate)
    {
        _shipments.Add(new Shipment(origin, destination, weight, declaredValue, requiresSignature, pickupDate));
    }
}
`, 'too-many-positional-arguments')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag 5 parameters or a params tail', () => {
    const found = matches(`namespace App;
public class AlertService
{
    public void Raise(string source, string title, string detail, int severity, params string[] tags)
    {
        _sink.Write(source, title, detail, severity, tags);
    }
}
`, 'too-many-positional-arguments')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// too-many-public-methods
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/too-many-public-methods (C#)', () => {
  it('detects a class with more than 20 public methods', () => {
    const methods = Array.from({ length: 21 }, (_, i) =>
      `    public bool CheckRule${i}(Order order) => order.RuleFlags[${i}];`).join('\n')
    const found = matches(`namespace App;
public class OrderRuleEngine
{
${methods}
}
`, 'too-many-public-methods')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not count private methods', () => {
    const methods = Array.from({ length: 21 }, (_, i) =>
      `    private bool CheckRule${i}(Order order) => order.RuleFlags[${i}];`).join('\n')
    const found = matches(`namespace App;
public class OrderRuleEngine
{
    public bool CheckAll(Order order) => Enumerable.Range(0, 21).All(i => order.RuleFlags[i]);
${methods}
}
`, 'too-many-public-methods')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// too-many-boolean-expressions
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/too-many-boolean-expressions (C#)', () => {
  it('detects a condition with more than 3 clauses', () => {
    const found = matches(`namespace App;
public class SignupGate
{
    public bool CanRegister(Applicant a)
    {
        if (a.IsActive && a.EmailConfirmed && !a.IsLocked && a.Age >= 18 && a.Country == "US")
        {
            return true;
        }
        return false;
    }
}
`, 'too-many-boolean-expressions')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a 3-clause condition', () => {
    const found = matches(`namespace App;
public class FulfillmentGate
{
    public bool CanShip(Order order)
    {
        return order.IsPaid && !order.IsShipped && order.Items.Count > 0;
    }
}
`, 'too-many-boolean-expressions')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// magic-number
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/magic-number (C#)', () => {
  it('detects an unexplained numeric literal in a comparison', () => {
    const found = matches(`namespace App;
public class PasswordPolicy
{
    public void Enforce(string password)
    {
        if (password.Length < 12)
        {
            throw new ArgumentException("password is too short");
        }
    }
}
`, 'magic-number')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag constants, HTTP statuses, or time-factor products', () => {
    const found = matches(`namespace App;
public class TokenCache
{
    private const int RefreshWindowSeconds = 90;

    public bool IsExpired(Token token)
    {
        var ttlSeconds = 24 * 60 * 60;
        if (token.StatusCode == 404) return false;
        return token.AgeSeconds > ttlSeconds + RefreshWindowSeconds;
    }
}
`, 'magic-number')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// magic-string / duplicate-string
// ---------------------------------------------------------------------------

const repeatedStringFixture = `namespace App;
public class PaymentProcessor
{
    public void Charge(Order order)
    {
        if (order.Total <= 0)
        {
            throw new InvalidOperationException("payment amount must be positive");
        }
        _log.Warn("payment amount must be positive");
        Reject(order, "payment amount must be positive");
    }
}
`

const tokenStringsFixture = `namespace App;
[ApiController]
public class OrdersController : ControllerBase
{
    [HttpGet("api/orders")]
    public IActionResult List() => Ok(_repo.GetAll("orders"));

    [HttpPost("api/orders")]
    public IActionResult Create() => Ok(_repo.Insert("orders"));

    [HttpDelete("api/orders")]
    public IActionResult Delete() => Ok(_repo.Remove("orders"));
}
`

describe('code-quality/deterministic/magic-string (C#)', () => {
  it('detects a string repeated 3 times', () => {
    expect(matches(repeatedStringFixture, 'magic-string').length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag attribute routes or identifier tokens', () => {
    expect(matches(tokenStringsFixture, 'magic-string')).toHaveLength(0)
  })
})

describe('code-quality/deterministic/duplicate-string (C#)', () => {
  it('detects a string repeated 3 times', () => {
    expect(matches(repeatedStringFixture, 'duplicate-string').length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag attribute routes or identifier tokens', () => {
    expect(matches(tokenStringsFixture, 'duplicate-string')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// identical-functions
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/identical-functions (C#)', () => {
  it('detects two methods with identical bodies', () => {
    const found = matches(`namespace App;
public class CustomerValidator
{
    public bool ValidateShipping(Address address)
    {
        if (address == null) return false;
        if (string.IsNullOrWhiteSpace(address.Street)) return false;
        return address.PostalCode.Length >= 5;
    }

    public bool ValidateBilling(Address address)
    {
        if (address == null) return false;
        if (string.IsNullOrWhiteSpace(address.Street)) return false;
        return address.PostalCode.Length >= 5;
    }
}
`, 'identical-functions')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag expression-bodied delegators or NotImplemented stubs', () => {
    const found = matches(`namespace App;
public class LedgerFacade
{
    public decimal PendingTotal() => _entries.Where(e => e.Pending).Sum(e => e.Amount);
    public decimal PostedTotal() => _entries.Where(e => e.Pending).Sum(e => e.Amount);

    public void Archive()
    {
        throw new NotImplementedException();
    }

    public void Purge()
    {
        throw new NotImplementedException();
    }
}
`, 'identical-functions')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// empty-function / no-empty-function
// ---------------------------------------------------------------------------

const emptyMethodFixture = `namespace App;
public class AuditSink
{
    public void Flush()
    {
    }
}
`

const intentionalEmptyBodiesFixture = `namespace App;
public class WebhookProcessor : ProcessorBase
{
    private WebhookProcessor()
    {
    }

    protected virtual void OnDrained()
    {
    }

    public override void Warmup()
    {
    }

    public void Configure(IAppBuilder app)
    {
        app.OnShutdown(() => { });
    }

    public void Drain()
    {
        // nothing to drain — the queue is flushed by the host on shutdown
    }
}
`

describe('code-quality/deterministic/empty-function (C#)', () => {
  it('detects an empty method body', () => {
    expect(matches(emptyMethodFixture, 'empty-function').length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag virtual hooks, overrides, EF constructors, no-op callbacks, or commented bodies', () => {
    expect(matches(intentionalEmptyBodiesFixture, 'empty-function')).toHaveLength(0)
  })
})

describe('code-quality/deterministic/no-empty-function (C#)', () => {
  it('detects an empty method body', () => {
    expect(matches(emptyMethodFixture, 'no-empty-function').length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag virtual hooks, overrides, EF constructors, no-op callbacks, or commented bodies', () => {
    expect(matches(intentionalEmptyBodiesFixture, 'no-empty-function')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// boolean-trap
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/boolean-trap (C#)', () => {
  it('detects a positional boolean in a multi-argument call', () => {
    const found = matches(`namespace App;
public class ReportScheduler
{
    public void ScheduleMonthly()
    {
        QueueExport("monthly-sales", true, false);
    }

    private void QueueExport(string name, bool compress, bool notify)
    {
        _queue.Enqueue(new ExportJob(name, compress, notify));
    }
}
`, 'boolean-trap')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag named arguments or member-call setters', () => {
    const found = matches(`namespace App;
public class ReportScheduler
{
    public void ScheduleMonthly()
    {
        QueueExport("monthly-sales", compress: true, notify: false);
        _featureFlags.Set("exports-enabled", true);
    }

    private void QueueExport(string name, bool compress, bool notify)
    {
        _queue.Enqueue(new ExportJob(name, compress, notify));
    }
}
`, 'boolean-trap')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unused-variable
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unused-variable (C#)', () => {
  it('detects a local that is never read', () => {
    const found = matches(`namespace App;
public class CartService
{
    public decimal Subtotal(List<LineItem> items)
    {
        var legacyTotal = items.Sum(i => i.Price);
        return items.Where(i => i.Quantity > 0).Sum(i => i.Price * i.Quantity);
    }
}
`, 'unused-variable')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag using declarations or locals read inside lambdas', () => {
    const found = matches(`namespace App;
public class CartService
{
    public decimal Subtotal(List<LineItem> items)
    {
        using var timer = _metrics.Measure("cart-subtotal");
        var taxRate = LoadTaxRate();
        var total = items.Sum(i => i.Price * (1 + taxRate));
        return total;
    }
}
`, 'unused-variable')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// dead-store
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/dead-store (C#)', () => {
  it('detects a value overwritten before being read', () => {
    const found = matches(`namespace App;
public class LabelService
{
    public string ResolveLabel(Order order)
    {
        var label = order.Reference;
        label = BuildLabel(order);
        return label;
    }
}
`, 'dead-store')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag self-referencing updates or assignments separated by early returns', () => {
    const found = matches(`namespace App;
public class PagingService
{
    public int NextOffset(int page, int size)
    {
        var offset = page * size;
        offset = Math.Max(offset, 0);
        return offset;
    }

    public bool TryReadPort(string raw, out int port)
    {
        port = 0;
        if (!int.TryParse(raw, out var parsed)) return false;
        port = parsed;
        return true;
    }
}
`, 'dead-store')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unused-function-parameter
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unused-function-parameter (C#)', () => {
  it('detects a parameter never used in the body', () => {
    const found = matches(`namespace App;
public class PricingService
{
    public decimal ApplyDiscount(decimal price, string promoCode)
    {
        return price * 0.9m;
    }
}
`, 'unused-function-parameter')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag overrides, event handlers, or NotImplemented stubs', () => {
    const found = matches(`namespace App;
public class ExportJob : JobBase
{
    public override Task RunAsync(JobContext context) => Task.CompletedTask;

    private void OnTimer(object sender, ElapsedEventArgs e)
    {
        _ticks++;
    }

    public void Rollback(string reason)
    {
        throw new NotImplementedException();
    }
}
`, 'unused-function-parameter')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// parameter-reassignment
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/parameter-reassignment (C#)', () => {
  it('detects reassigning a parameter', () => {
    const found = matches(`namespace App;
public class SkuNormalizer
{
    public string NormalizeCode(string code)
    {
        code = code.Trim().ToUpperInvariant();
        return code;
    }
}
`, 'parameter-reassignment')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag out/ref parameters or local assignments', () => {
    const found = matches(`namespace App;
public class PortParser
{
    public bool TryParsePort(string raw, out int port)
    {
        port = 0;
        if (!int.TryParse(raw, out var parsed)) return false;
        port = parsed;
        var valid = port > 0;
        return valid;
    }
}
`, 'parameter-reassignment')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// nested-ternary
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/nested-ternary (C#)', () => {
  it('detects a ternary inside a ternary', () => {
    const found = matches(`namespace App;
public class CustomerTiering
{
    public string Tier(Customer customer)
    {
        var tier = customer.LifetimeSpend > 10000 ? (customer.IsVip ? "platinum" : "gold") : "standard";
        return tier;
    }
}
`, 'nested-ternary')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a simple ternary or a switch expression', () => {
    const found = matches(`namespace App;
public class CustomerTiering
{
    public string Tier(Customer customer)
    {
        var label = customer.IsVip ? "vip" : "standard";
        return label;
    }

    public string Band(decimal spend) => spend switch
    {
        > 10000 => "platinum",
        > 1000 => "gold",
        _ => "standard",
    };
}
`, 'nested-ternary')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// nested-switch
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/nested-switch (C#)', () => {
  it('detects a switch inside a switch', () => {
    const found = matches(`namespace App;
public class CommandRouter
{
    public void Route(string area, string action)
    {
        switch (area)
        {
            case "billing":
                switch (action)
                {
                    case "charge":
                        _billing.Charge();
                        break;
                    default:
                        _billing.Report(action);
                        break;
                }
                break;
            default:
                _audit.Unknown(area);
                break;
        }
    }
}
`, 'nested-switch')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag separate switches or a switch inside a lambda', () => {
    const found = matches(`namespace App;
public class CommandRouter
{
    public void Route(string area)
    {
        switch (area)
        {
            case "billing":
                _handlers.ForEach(h =>
                {
                    switch (h.Mode)
                    {
                        case "sync":
                            h.Run();
                            break;
                        default:
                            h.Queue();
                            break;
                    }
                });
                break;
            default:
                _audit.Unknown(area);
                break;
        }
    }
}
`, 'nested-switch')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// collapsible-if
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/collapsible-if (C#)', () => {
  it('detects an if whose only statement is another if', () => {
    const found = matches(`namespace App;
public class NotificationService
{
    public void Notify(Customer customer)
    {
        if (customer.OptedIn)
        {
            if (customer.Email != null)
            {
                _mailer.Send(customer.Email);
            }
        }
    }
}
`, 'collapsible-if')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag when the outer block has other statements or the inner if has an else', () => {
    const found = matches(`namespace App;
public class NotificationService
{
    public void Notify(Customer customer)
    {
        if (customer.OptedIn)
        {
            _log.Info("customer opted in");
            if (customer.Email != null)
            {
                _mailer.Send(customer.Email);
            }
        }
        if (customer.SmsOptedIn)
        {
            if (customer.Phone != null)
            {
                _sms.Send(customer.Phone);
            }
            else
            {
                _log.Info("sms opt-in without phone number");
            }
        }
    }
}
`, 'collapsible-if')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// collapsible-else-if / no-lonely-if
// ---------------------------------------------------------------------------

const lonelyIfFixture = `namespace App;
public class RequestRouter
{
    public void Route(Request request)
    {
        if (request.IsLocal)
        {
            HandleLocal(request);
        }
        else
        {
            if (request.HasToken)
            {
                HandleRemote(request);
            }
        }
    }
}
`

const properElseIfFixture = `namespace App;
public class RequestRouter
{
    public void Route(Request request)
    {
        if (request.IsLocal)
        {
            HandleLocal(request);
        }
        else if (request.HasToken)
        {
            HandleRemote(request);
        }
        else
        {
            _log.Warn("unauthenticated request rejected");
            Reject(request);
        }
    }
}
`

describe('code-quality/deterministic/collapsible-else-if (C#)', () => {
  it('detects else { if } blocks', () => {
    expect(matches(lonelyIfFixture, 'collapsible-else-if').length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag else-if chains or multi-statement else blocks', () => {
    expect(matches(properElseIfFixture, 'collapsible-else-if')).toHaveLength(0)
  })
})

describe('code-quality/deterministic/no-lonely-if (C#)', () => {
  it('detects else { if } blocks', () => {
    expect(matches(lonelyIfFixture, 'no-lonely-if').length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag else-if chains or multi-statement else blocks', () => {
    expect(matches(properElseIfFixture, 'no-lonely-if')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// commented-out-code
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/commented-out-code (C#)', () => {
  it('detects commented-out statements', () => {
    const found = matches(`namespace App;
public class RetryPolicy
{
    public void Execute(Action work)
    {
        // var retries = LoadRetryBudget();
        // if (retries > 0) { ScheduleRetry(work); }
        work();
    }
}
`, 'commented-out-code')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag XML docs or prose comments', () => {
    const found = matches(`namespace App;
public class RetryPolicy
{
    /// <summary>Executes the work item under the configured retry budget.</summary>
    public void Execute(Action work)
    {
        // Retries are handled by the outbox dispatcher, not here.
        work();
    }
}
`, 'commented-out-code')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// expression-complexity
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/expression-complexity (C#)', () => {
  it('detects an expression with more than 5 operators', () => {
    const found = matches(`namespace App;
public class QuoteCalculator
{
    public decimal Total(Quote quote)
    {
        var total = quote.BasePrice + quote.Tax + quote.Shipping - quote.Discount + quote.Surcharge * quote.Weight + quote.Handling;
        return total;
    }
}
`, 'expression-complexity')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not charge operators inside LINQ lambdas to the outer statement', () => {
    const found = matches(`namespace App;
public class QuoteCalculator
{
    public decimal TaxedTotal(IEnumerable<Order> orders, decimal minTotal, decimal taxRate)
    {
        var result = orders.Where(o => o.Total > minTotal && o.Active && !o.Refunded).Select(o => o.Total * (1 + taxRate) - o.Credit).Sum();
        return result;
    }
}
`, 'expression-complexity')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// deeply-nested-functions
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/deeply-nested-functions (C#)', () => {
  it('detects a local function nested 3 levels deep', () => {
    const found = matches(`namespace App;
public class GridSolver
{
    public int Solve(int[][] grid)
    {
        int Score(int row)
        {
            int RowTotal(int col)
            {
                int CellWeight(int value)
                {
                    return value * 2;
                }
                return CellWeight(grid[row][col]);
            }
            return RowTotal(0);
        }
        return Score(0);
    }
}
`, 'deeply-nested-functions')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag nested lambdas or a single local function', () => {
    const found = matches(`namespace App;
public class RegionReport
{
    public List<Order> Winners(IEnumerable<Order> orders)
    {
        decimal Weight(Order order)
        {
            return order.Total * (order.IsVip ? 2 : 1);
        }
        return orders.GroupBy(o => o.Region).Select(g => g.OrderByDescending(o => Weight(o)).First()).ToList();
    }
}
`, 'deeply-nested-functions')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unnecessary-else-after-return
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unnecessary-else-after-return (C#)', () => {
  it('detects an else block after a returning if', () => {
    const found = matches(`namespace App;
public class ShippingCalculator
{
    public decimal ShippingFee(Order order)
    {
        if (order.Total >= 100)
        {
            return 0m;
        }
        else
        {
            return order.Weight * order.RatePerKilo;
        }
    }
}
`, 'unnecessary-else-after-return')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag else-if chains or boolean-literal pairs', () => {
    const found = matches(`namespace App;
public class OrderClassifier
{
    public bool IsBulk(Order order)
    {
        if (order.Lines.Count > 50)
        {
            return true;
        }
        else
        {
            return false;
        }
    }

    public string Lane(Order order)
    {
        var lane = "ground";
        if (order.IsExpress)
        {
            lane = "express";
        }
        else if (order.IsInternational)
        {
            lane = "customs";
        }
        return lane;
    }
}
`, 'unnecessary-else-after-return')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// prefer-single-boolean-return
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/prefer-single-boolean-return (C#)', () => {
  it('detects if-return-true / return-false shapes', () => {
    const found = matches(`namespace App;
public class EligibilityCheck
{
    public bool IsEligible(Customer customer)
    {
        if (customer.Age >= 18)
        {
            return true;
        }
        return false;
    }
}
`, 'prefer-single-boolean-return')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag guard clauses followed by an expression return', () => {
    const found = matches(`namespace App;
public class AccessCheck
{
    public bool HasAccess(User user)
    {
        if (user == null)
        {
            return false;
        }
        return user.Roles.Contains("admin");
    }
}
`, 'prefer-single-boolean-return')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// default-case-in-switch
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/default-case-in-switch (C#)', () => {
  it('detects a switch statement without a default section', () => {
    const found = matches(`namespace App;
public class DocumentActions
{
    public void Apply(string action, Document doc)
    {
        switch (action)
        {
            case "publish":
                doc.Publish();
                break;
            case "archive":
                doc.Archive();
                break;
        }
    }
}
`, 'default-case-in-switch')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a switch with a default section', () => {
    const found = matches(`namespace App;
public class DocumentActions
{
    public void Apply(string action, Document doc)
    {
        switch (action)
        {
            case "publish":
                doc.Publish();
                break;
            case "archive":
                doc.Archive();
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(action));
        }
    }
}
`, 'default-case-in-switch')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// default-case-last
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/default-case-last (C#)', () => {
  it('detects a default section that is not last', () => {
    const found = matches(`namespace App;
public class LogLevelMapper
{
    public int Map(string level)
    {
        switch (level)
        {
            case "debug":
                return 0;
            default:
                return 2;
            case "error":
                return 4;
        }
    }
}
`, 'default-case-last')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a default section in last position', () => {
    const found = matches(`namespace App;
public class LogLevelMapper
{
    public int Map(string level)
    {
        switch (level)
        {
            case "debug":
                return 0;
            case "error":
                return 4;
            default:
                return 2;
        }
    }
}
`, 'default-case-last')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// equals-in-for-termination
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/equals-in-for-termination (C#)', () => {
  it('detects assignment used as the loop condition', () => {
    const found = matches(`namespace App;
public class JobDrainer
{
    public void Drain(JobQueue queue)
    {
        var hasMore = false;
        for (var i = 0; hasMore = queue.TryPeek(); i++)
        {
            Process(queue.Dequeue());
        }
    }
}
`, 'equals-in-for-termination')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a normal comparison condition', () => {
    const found = matches(`namespace App;
public class JobDrainer
{
    public void Drain(List<Job> jobs)
    {
        for (var i = 0; i < jobs.Count; i++)
        {
            Process(jobs[i]);
        }
    }
}
`, 'equals-in-for-termination')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unnecessary-namespace-qualifier
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unnecessary-namespace-qualifier (C#)', () => {
  it('detects a fully qualified type whose namespace is already imported', () => {
    const found = matches(`using System.Text;

namespace App;
public class CsvWriter
{
    public string Build(IEnumerable<string[]> rows)
    {
        var sb = new System.Text.StringBuilder();
        foreach (var row in rows)
        {
            sb.AppendLine(string.Join(",", row));
        }
        return sb.ToString();
    }
}
`, 'unnecessary-namespace-qualifier')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag qualifiers for namespaces that are not imported, static usings, or aliases', () => {
    const found = matches(`using System.Text;
using static System.Math;
using Json = System.Text.Json.JsonSerializer;

namespace App;
public class ManifestWriter
{
    public void Write(Manifest manifest, string root)
    {
        var path = System.IO.Path.Combine(root, "manifest.json");
        var rounded = Min(manifest.Weight, 100.0);
        System.IO.File.WriteAllText(path, Json.Serialize(manifest));
    }
}
`, 'unnecessary-namespace-qualifier')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unsafe-any-usage (C# analog: dynamic)
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unsafe-any-usage (C#)', () => {
  it('detects dynamic locals and parameters', () => {
    const found = matches(`namespace App;
public class WebhookHandler
{
    public void Handle(string payload)
    {
        dynamic data = JsonConvert.DeserializeObject(payload);
        ProcessOrder(data.OrderId, data.Amount);
    }

    private void Forward(dynamic envelope)
    {
        _bus.Publish(envelope.Topic, envelope.Body);
    }
}
`, 'unsafe-any-usage')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag object-typed members or identifiers that merely contain "dynamic"', () => {
    const found = matches(`namespace App;
public class QueryBuilder
{
    private readonly Dictionary<string, object> _parameters = new();

    public void AddParameter(string name, object value)
    {
        _parameters[name] = value;
    }

    public string ApplyDynamicFilters(List<string> dynamicFilters)
    {
        return string.Join(" AND ", dynamicFilters);
    }
}
`, 'unsafe-any-usage')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// double-negation / inverted-boolean
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/double-negation (C#)', () => {
  it('detects !!flag', () => {
    const found = matches(`namespace App;
public class FeatureGate
{
    public bool IsEnabled(Tenant tenant)
    {
        return !!tenant.Flags.ExportsEnabled;
    }
}
`, 'double-negation')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a single negation', () => {
    const found = matches(`namespace App;
public class FeatureGate
{
    public bool IsDisabled(Tenant tenant)
    {
        return !tenant.Flags.ExportsEnabled;
    }
}
`, 'double-negation')
    expect(found).toHaveLength(0)
  })
})

describe('code-quality/deterministic/inverted-boolean (C#)', () => {
  it('detects !(!x)', () => {
    const found = matches(`namespace App;
public class FeatureGate
{
    public bool IsEnabled(Tenant tenant)
    {
        return !(!tenant.IsActive);
    }
}
`, 'inverted-boolean')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag negating a parenthesized comparison', () => {
    const found = matches(`namespace App;
public class FeatureGate
{
    public bool IsLegacy(Tenant tenant)
    {
        return !(tenant.PlanVersion >= MinimumPlanVersion);
    }
}
`, 'inverted-boolean')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// negated-condition
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/negated-condition (C#)', () => {
  it('detects a negated condition with a much larger else branch', () => {
    const found = matches(`namespace App;
public class CheckoutFlow
{
    public void Complete(Cart cart)
    {
        if (!cart.IsValid)
        {
            _log.Warn("invalid cart rejected");
        }
        else
        {
            var order = _orders.CreateFrom(cart);
            _payments.Authorize(order);
            _inventory.Reserve(order);
            _mailer.SendConfirmation(order);
        }
    }
}
`, 'negated-condition')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag guard-style negation without else or balanced branches', () => {
    const found = matches(`namespace App;
public class CheckoutFlow
{
    public void Complete(Cart cart)
    {
        if (!cart.IsValid)
        {
            _log.Warn("invalid cart rejected");
            return;
        }
        if (!cart.HasItems)
        {
            _log.Warn("empty cart skipped");
        }
        else
        {
            _orders.CreateFrom(cart);
        }
    }
}
`, 'negated-condition')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// redundant-jump
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/redundant-jump (C#)', () => {
  it('detects a trailing return in a void method and a trailing continue', () => {
    const found = matches(`namespace App;
public class QueueWorker
{
    public void Drain(IEnumerable<Job> jobs)
    {
        foreach (var job in jobs)
        {
            _runner.Execute(job);
            continue;
        }
        return;
    }
}
`, 'redundant-jump')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag early returns or continues inside conditionals', () => {
    const found = matches(`namespace App;
public class QueueWorker
{
    public void Drain(IEnumerable<Job> jobs)
    {
        foreach (var job in jobs)
        {
            if (job.IsPoisoned)
            {
                continue;
            }
            _runner.Execute(job);
        }
    }

    public void Stop()
    {
        if (_stopped) return;
        _stopped = true;
    }
}
`, 'redundant-jump')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// no-useless-catch / useless-catch
// ---------------------------------------------------------------------------

const uselessCatchFixture = `namespace App;
public class DocumentLoader
{
    public Document Load(string path)
    {
        try
        {
            return _parser.Parse(File.ReadAllText(path));
        }
        catch (Exception ex)
        {
            throw ex;
        }
    }
}
`

const meaningfulCatchFixture = `namespace App;
public class DocumentLoader
{
    public Document Load(string path)
    {
        try
        {
            return _parser.Parse(File.ReadAllText(path));
        }
        catch (FileNotFoundException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log.Error(ex, "failed to load document");
            throw new DocumentLoadException(path, ex);
        }
    }

    public Document LoadOrNull(string path)
    {
        try
        {
            return Load(path);
        }
        catch (IOException ex) when (ex.HResult == SharingViolation)
        {
            throw;
        }
    }
}
`

describe('code-quality/deterministic/no-useless-catch (C#)', () => {
  it('detects a catch that only rethrows', () => {
    expect(matches(uselessCatchFixture, 'no-useless-catch').length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag rethrow among multiple catches or with a when filter', () => {
    expect(matches(meaningfulCatchFixture, 'no-useless-catch')).toHaveLength(0)
  })
})

describe('code-quality/deterministic/useless-catch (C#)', () => {
  it('detects a catch that only rethrows', () => {
    expect(matches(uselessCatchFixture, 'useless-catch').length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag rethrow among multiple catches or with a when filter', () => {
    expect(matches(meaningfulCatchFixture, 'useless-catch')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// useless-constructor
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/useless-constructor (C#)', () => {
  it('detects a lone empty public parameterless constructor', () => {
    const found = matches(`namespace App;
public class AuditEvent
{
    public AuditEvent()
    {
    }

    public string Action { get; set; }
}
`, 'useless-constructor')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag constructors that overloads, visibility, or attributes make load-bearing', () => {
    const found = matches(`namespace App;
public class OrderSnapshot
{
    public OrderSnapshot()
    {
    }

    [JsonConstructor]
    public OrderSnapshot(string id)
    {
        Id = id;
    }

    public string Id { get; set; }
}

public class LegacyClient
{
    private LegacyClient()
    {
    }
}
`, 'useless-constructor')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// no-return-assign / multi-assign
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/no-return-assign (C#)', () => {
  it('detects assignment inside a return', () => {
    const found = matches(`namespace App;
public class SessionCache
{
    public Session Current()
    {
        return _current = _store.Load();
    }
}
`, 'no-return-assign')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag returning a comparison or the null-coalescing cache idiom', () => {
    const found = matches(`namespace App;
public class SessionCache
{
    public bool IsCurrent(Session session)
    {
        return session.Id == _current.Id;
    }

    public Session Current()
    {
        return _current ?? _store.Load();
    }
}
`, 'no-return-assign')
    expect(found).toHaveLength(0)
  })
})

describe('code-quality/deterministic/multi-assign (C#)', () => {
  it('detects chained assignment', () => {
    const found = matches(`namespace App;
public class CounterReset
{
    public void Reset()
    {
        _processed = _failed = 0;
    }
}
`, 'multi-assign')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag separate assignments or object initializers', () => {
    const found = matches(`namespace App;
public class CounterReset
{
    public Stats Snapshot()
    {
        _processed = 0;
        _failed = 0;
        return new Stats { Processed = _processed, Failed = _failed };
    }
}
`, 'multi-assign')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// no-debugger / debugger-statement
// ---------------------------------------------------------------------------

const debuggerCallFixture = `namespace App;
public class PaymentReconciler
{
    public void Reconcile(Batch batch)
    {
        if (batch.HasMismatch)
        {
            Debugger.Break();
        }
        _ledger.Apply(batch);
    }
}
`

const noDebuggerFixture = `namespace App;
public class PaymentReconciler
{
    public void Reconcile(Batch batch)
    {
        if (batch.HasMismatch)
        {
            _log.Error("ledger mismatch in batch {Id}", batch.Id);
        }
        _ledger.Apply(batch);
    }
}
`

describe('code-quality/deterministic/no-debugger (C#)', () => {
  it('detects Debugger.Break()', () => {
    expect(matches(debuggerCallFixture, 'no-debugger').length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag normal logging', () => {
    expect(matches(noDebuggerFixture, 'no-debugger')).toHaveLength(0)
  })
})

describe('code-quality/deterministic/debugger-statement (C#)', () => {
  it('detects Debugger.Break()', () => {
    expect(matches(debuggerCallFixture, 'debugger-statement').length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag normal logging', () => {
    expect(matches(noDebuggerFixture, 'debugger-statement')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// yoda-condition
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/yoda-condition (C#)', () => {
  it('detects a constant on the left of a comparison', () => {
    const found = matches(`namespace App;
public class StockGuard
{
    public bool NeedsRestock(Product product)
    {
        return 10 > product.UnitsInStock;
    }
}
`, 'yoda-condition')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag variable-first comparisons or constant-to-constant checks', () => {
    const found = matches(`namespace App;
public class StockGuard
{
    public bool NeedsRestock(Product product)
    {
        return product.UnitsInStock < ReorderThreshold && product.Supplier != null;
    }
}
`, 'yoda-condition')
    expect(found).toHaveLength(0)
  })
})

// ===========================================================================
// Second port wave: control flow, class analysis, env/API, regex-*, test-*
// ===========================================================================

function matchesAt(filePath: string, code: string, ruleKey: string) {
  const tree = parseCode(code, 'csharp')
  return checkCodeRules(tree, filePath, code, enabledRules, 'csharp')
    .filter((v) => v.ruleKey === `code-quality/deterministic/${ruleKey}`)
}

// ---------------------------------------------------------------------------
// too-many-statements
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/too-many-statements (C#)', () => {
  it('detects a method with more than 50 statements counted through nested blocks', () => {
    const validations = Array.from({ length: 52 }, (_, i) => `        ValidateField(record, ${i});`).join('\n')
    const found = matches(`namespace App;
public class RecordValidator
{
    public void ValidateAll(ImportRecord record)
    {
${validations}
    }
}
`, 'too-many-statements')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a normal-sized method with nested blocks', () => {
    const found = matches(`namespace App;
public class RecordValidator
{
    public List<string> Validate(ImportRecord record)
    {
        var errors = new List<string>();
        if (string.IsNullOrEmpty(record.Sku))
        {
            errors.Add("sku is required");
        }
        foreach (var line in record.Lines)
        {
            if (line.Quantity <= 0)
            {
                errors.Add($"invalid quantity for {line.Sku}");
            }
        }
        return errors;
    }
}
`, 'too-many-statements')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// too-many-nested-blocks
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/too-many-nested-blocks (C#)', () => {
  it('detects six levels of nesting', () => {
    const found = matches(`namespace App;
public class WarehouseScanner
{
    public void Reconcile(List<Site> sites)
    {
        foreach (var site in sites)
        {
            if (site.IsActive)
            {
                foreach (var zone in site.Zones)
                {
                    if (zone.RequiresAudit)
                    {
                        foreach (var shelf in zone.Shelves)
                        {
                            if (shelf.Count != shelf.Expected)
                            {
                                ReportMismatch(site, zone, shelf);
                            }
                        }
                    }
                }
            }
        }
    }
}
`, 'too-many-nested-blocks')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag shallow nesting', () => {
    const found = matches(`namespace App;
public class WarehouseScanner
{
    public void Reconcile(List<Site> sites)
    {
        foreach (var site in sites)
        {
            if (!site.IsActive) continue;
            ReconcileSite(site);
        }
    }
}
`, 'too-many-nested-blocks')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// superfluous-else-after-control
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/superfluous-else-after-control (C#)', () => {
  it('detects else after continue', () => {
    const found = matches(`namespace App;
public class StockReserver
{
    public void ReserveAll(List<OrderLine> lines)
    {
        foreach (var line in lines)
        {
            if (line.Quantity <= 0)
            {
                continue;
            }
            else
            {
                Reserve(line);
            }
        }
    }
}
`, 'superfluous-else-after-control')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a normal if/else, and leaves else-after-return to its own rule', () => {
    const found = matches(`namespace App;
public class OrderRouter
{
    public void Route(Order order)
    {
        if (order.IsPaid)
        {
            Ship(order);
        }
        else
        {
            Hold(order);
        }
    }

    public decimal Fee(Order order)
    {
        if (order.IsExpress)
        {
            return 15m;
        }
        else
        {
            return 5m;
        }
    }
}
`, 'superfluous-else-after-control')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// if-with-same-arms
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/if-with-same-arms (C#)', () => {
  it('detects identical if and else bodies', () => {
    const found = matches(`namespace App;
public class QuotaService
{
    public int ResolveQuota(User user)
    {
        int quota;
        if (user.IsPremium)
        {
            quota = ComputeQuota(user);
        }
        else
        {
            quota = ComputeQuota(user);
        }
        return quota;
    }
}
`, 'if-with-same-arms')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag branches with different bodies', () => {
    const found = matches(`namespace App;
public class QuotaService
{
    public int ResolveQuota(User user)
    {
        if (user.IsPremium)
        {
            return ComputePremiumQuota(user);
        }
        return ComputeBaseQuota(user);
    }
}
`, 'if-with-same-arms')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// trivial-ternary
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/trivial-ternary (C#)', () => {
  it('detects cond ? true : false', () => {
    const found = matches(`namespace App;
public class AgeGate
{
    public bool IsAdult(int age) => age >= 18 ? true : false;
}
`, 'trivial-ternary')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag value-producing ternaries', () => {
    const found = matches(`namespace App;
public class LabelFormatter
{
    public string Format(bool active) => active ? "Active" : "Suspended";
}
`, 'trivial-ternary')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// trivial-switch
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/trivial-switch (C#)', () => {
  it('detects a two-section switch statement', () => {
    const found = matches(`namespace App;
public class ExportWriter
{
    public void Write(string format, Report payload)
    {
        switch (format)
        {
            case "json":
                WriteJson(payload);
                break;
            default:
                WriteText(payload);
                break;
        }
    }
}
`, 'trivial-switch')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag two-arm switch EXPRESSIONS or larger switch statements', () => {
    const found = matches(`namespace App;
public class ExportWriter
{
    public string ContentType(string format) => format switch
    {
        "json" => "application/json",
        _ => "text/plain",
    };

    public void Write(string format, Report payload)
    {
        switch (format)
        {
            case "json":
                WriteJson(payload);
                break;
            case "csv":
                WriteCsv(payload);
                break;
            case "xml":
                WriteXml(payload);
                break;
            default:
                WriteText(payload);
                break;
        }
    }
}
`, 'trivial-switch')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// contradictory-boolean-expression
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/contradictory-boolean-expression (C#)', () => {
  it('detects a condition ANDed with its own negation', () => {
    const found = matches(`namespace App;
public class RefundPolicy
{
    public bool CanRefund(Order order)
    {
        return order.IsPaid && !order.IsPaid;
    }
}
`, 'contradictory-boolean-expression')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag negations of different conditions', () => {
    const found = matches(`namespace App;
public class RefundPolicy
{
    public bool CanRefund(Order order)
    {
        return order.IsPaid && !order.IsCancelled && order.Age < RefundWindow;
    }
}
`, 'contradictory-boolean-expression')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// comparison-of-constant
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/comparison-of-constant (C#)', () => {
  it('detects a literal-to-literal comparison', () => {
    const found = matches(`namespace App;
public class MigrationGuard
{
    public void Run()
    {
        if (1 == 2)
        {
            DropLegacyTables();
        }
    }
}
`, 'comparison-of-constant')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag variable-to-literal comparisons', () => {
    const found = matches(`namespace App;
public class RetryPolicy
{
    public bool ShouldRetry(int attempts) => attempts < 3;
}
`, 'comparison-of-constant')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// no-extraneous-class
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/no-extraneous-class (C#)', () => {
  it('detects a non-static class with only static members', () => {
    const found = matches(`namespace App;
public class SlugHelper
{
    public static string Slugify(string input) => input.ToLowerInvariant().Replace(' ', '-');
    public static bool IsBlank(string input) => string.IsNullOrWhiteSpace(input);
}
`, 'no-extraneous-class')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag static classes or classes with instance state', () => {
    const found = matches(`namespace App;
public static class SlugHelper
{
    public static string Slugify(string input) => input.ToLowerInvariant().Replace(' ', '-');
}

public class SlugCache
{
    private readonly Dictionary<string, string> _cache = new();
    public string GetOrAdd(string input) => _cache.TryGetValue(input, out var s) ? s : SlugHelper.Slugify(input);
}
`, 'no-extraneous-class')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// class-as-data-structure
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/class-as-data-structure (C#)', () => {
  it('detects a class exposing only public fields', () => {
    const found = matches(`namespace App;
public class ShippingQuote
{
    public decimal Amount;
    public string Carrier;
    public int EstimatedDays;
}
`, 'class-as-data-structure')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag idiomatic auto-property DTOs', () => {
    const found = matches(`namespace App;
public class ShippingQuote
{
    public decimal Amount { get; set; }
    public string Carrier { get; set; }
    public int EstimatedDays { get; set; }
}
`, 'class-as-data-structure')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// static-method-candidate
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/static-method-candidate (C#)', () => {
  it('detects a private method that uses no instance state', () => {
    const found = matches(`namespace App;
public class PriceCalculator
{
    private readonly decimal _taxRate;

    public PriceCalculator(decimal taxRate)
    {
        _taxRate = taxRate;
    }

    public decimal Total(decimal subtotal) => RoundCurrency(subtotal * (1 + _taxRate));

    private decimal RoundCurrency(decimal value)
    {
        return Math.Round(value, 2, MidpointRounding.AwayFromZero);
    }
}
`, 'static-method-candidate')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag methods that read fields, public DI-friendly methods, or derived classes', () => {
    const found = matches(`namespace App;
public class PriceCalculator
{
    private readonly decimal _taxRate;

    public PriceCalculator(decimal taxRate)
    {
        _taxRate = taxRate;
    }

    private decimal ApplyTax(decimal subtotal) => subtotal * (1 + _taxRate);

    public decimal Lookup(string sku) => CatalogPrices.Resolve(sku);
}

public class DiscountedCalculator : PriceCalculatorBase
{
    private decimal Halve(decimal value) => value / 2;
}
`, 'static-method-candidate')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unused-private-member
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unused-private-member (C#)', () => {
  it('detects a private field that is never accessed', () => {
    const found = matches(`namespace App;
public class InvoiceService
{
    private readonly IInvoiceRepository _repository;
    private int _retryLimit = 3;

    public InvoiceService(IInvoiceRepository repository)
    {
        _repository = repository;
    }

    public Task<Invoice> LoadAsync(string id) => _repository.GetAsync(id);
}
`, 'unused-private-member')
    expect(found.length).toBeGreaterThanOrEqual(1)
    expect(found[0].content).toContain('_retryLimit')
  })

  it('does not flag private fields that are read', () => {
    const found = matches(`namespace App;
public class InvoiceService
{
    private readonly IInvoiceRepository _repository;
    private int _retryLimit = 3;

    public InvoiceService(IInvoiceRepository repository)
    {
        _repository = repository;
    }

    public async Task<Invoice> LoadAsync(string id)
    {
        for (var attempt = 0; attempt < _retryLimit; attempt++)
        {
            var invoice = await _repository.GetAsync(id);
            if (invoice != null) return invoice;
        }
        throw new InvoiceNotFoundException(id);
    }
}
`, 'unused-private-member')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unused-private-method
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unused-private-method (C#)', () => {
  it('detects a private method that is never called', () => {
    const found = matches(`namespace App;
public class ReportBuilder
{
    public string Build(Report report) => Render(report);

    private string Render(Report report) => string.Join("\\n", report.Rows);

    private string RenderLegacy(Report report) => report.ToString();
}
`, 'unused-private-method')
    expect(found.length).toBeGreaterThanOrEqual(1)
    expect(found[0].content).toContain('RenderLegacy')
  })

  it('does not flag private methods used as method groups or called directly', () => {
    const found = matches(`namespace App;
public class ReportBuilder
{
    public string Build(Report report)
    {
        var rows = report.Rows.Select(FormatRow);
        return Render(rows);
    }

    private string FormatRow(ReportRow row) => $"{row.Label}: {row.Value}";

    private string Render(IEnumerable<string> rows) => string.Join("\\n", rows);
}
`, 'unused-private-method')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unused-private-nested-class
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unused-private-nested-class (C#)', () => {
  it('detects a private nested class that is never referenced', () => {
    const found = matches(`namespace App;
public class SyncEngine
{
    private class LegacyCursor
    {
        public int Offset { get; set; }
    }

    public void Sync(IEnumerable<Record> records)
    {
        foreach (var record in records)
        {
            Push(record);
        }
    }
}
`, 'unused-private-nested-class')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag nested classes that are instantiated', () => {
    const found = matches(`namespace App;
public class SyncEngine
{
    private class Cursor
    {
        public int Offset { get; set; }
    }

    public void Sync(IEnumerable<Record> records)
    {
        var cursor = new Cursor();
        foreach (var record in records)
        {
            Push(record, cursor.Offset++);
        }
    }
}
`, 'unused-private-nested-class')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unused-collection
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unused-collection (C#)', () => {
  it('detects a collection that is filled but never read', () => {
    const found = matches(`namespace App;
public class ImportAuditor
{
    public List<string> Audit(List<Order> orders)
    {
        var failures = new List<string>();
        foreach (var order in orders)
        {
            if (order.Total < 0)
            {
                failures.Add(order.Id);
            }
        }
        return CollectValidIds(orders);
    }
}
`, 'unused-collection')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag collections that are returned or read', () => {
    const found = matches(`namespace App;
public class ImportAuditor
{
    public List<string> Audit(List<Order> orders)
    {
        var failures = new List<string>();
        foreach (var order in orders)
        {
            if (order.Total < 0)
            {
                failures.Add(order.Id);
            }
        }
        return failures;
    }

    public int CountLargeBatches(List<Order> orders)
    {
        var batch = new List<Order>();
        var flushed = 0;
        foreach (var order in orders)
        {
            batch.Add(order);
            if (batch.Count == 100)
            {
                flushed++;
                batch.Clear();
            }
        }
        return flushed;
    }
}
`, 'unused-collection')
    expect(found).toHaveLength(0)
  })

  it('does not flag the HashSet.Add dedup idiom where the mutator result is read', () => {
    const found = matches(`namespace App;
public class DuplicateDetector
{
    public IEnumerable<Order> Distinct(IEnumerable<Order> orders)
    {
        var seen = new HashSet<string>();
        foreach (var order in orders)
        {
            if (!seen.Add(order.Id))
            {
                continue;
            }
            yield return order;
        }
    }
}
`, 'unused-collection')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// hardcoded-port
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/hardcoded-port (C#)', () => {
  it('detects a hardcoded port in a listener constructor and a port variable', () => {
    const found = matches(`namespace App;
public class MetricsServer
{
    public void Start()
    {
        var port = 9090;
        var listener = new TcpListener(IPAddress.Any, 8080);
        listener.Start();
    }
}
`, 'hardcoded-port')
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('does not flag port-like numbers in non-network contexts or configured ports', () => {
    const found = matches(`namespace App;
public class BatchProcessor
{
    public void Run(IConfiguration configuration)
    {
        var maxRecords = 8080;
        var port = configuration.GetValue<int>("Metrics:Port");
        Process(maxRecords, port);
    }
}
`, 'hardcoded-port')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// hardcoded-url
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/hardcoded-url (C#)', () => {
  it('detects a hardcoded service endpoint', () => {
    const found = matches(`namespace App;
public class BillingClient
{
    private readonly HttpClient _http;

    public BillingClient(HttpClient http)
    {
        _http = http;
        _http.BaseAddress = new Uri("https://billing.internal.acme.com/v1/");
    }
}
`, 'hardcoded-url')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag XML namespaces or localhost', () => {
    const found = matches(`namespace App;
public class SoapEnvelopeWriter
{
    private const string XsdNamespace = "http://www.w3.org/2001/XMLSchema";

    public void Write(XmlWriter writer)
    {
        writer.WriteAttributeString("xmlns:xsd", XsdNamespace);
    }
}

public class DevServer
{
    public string BaseUrl => "http://localhost:5000";
}
`, 'hardcoded-url')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// console-log
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/console-log (C#)', () => {
  it('detects Console.WriteLine in an ASP.NET controller', () => {
    const found = matchesAt('/src/Api/OrdersController.cs', `using Microsoft.AspNetCore.Mvc;
namespace App.Api;
[ApiController]
public class OrdersController : ControllerBase
{
    [HttpPost]
    public IActionResult Create(OrderRequest request)
    {
        Console.WriteLine($"creating order for {request.CustomerId}");
        return Ok();
    }
}
`, 'console-log')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag console output in a CLI entry point', () => {
    const found = matchesAt('/src/Exporter/Program.cs', `namespace Exporter;
public class Program
{
    public static void Main(string[] args)
    {
        if (args.Length == 0)
        {
            Console.WriteLine("Usage: exporter <path>");
            return;
        }
        new ExportRunner().Run(args[0]);
    }
}
`, 'console-log')
    expect(found).toHaveLength(0)
  })

  it('does not flag a plain library class with no server or logger signals', () => {
    const found = matchesAt('/src/Tools/CsvDumper.cs', `namespace Tools;
public class CsvDumper
{
    public void Dump(IEnumerable<string> rows)
    {
        foreach (var row in rows)
        {
            Console.WriteLine(row);
        }
    }
}
`, 'console-log')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// deprecated-api-usage
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/deprecated-api-usage (C#)', () => {
  it('detects calls to an in-file [Obsolete] method', () => {
    const found = matches(`namespace App;
public class TaxCalculator
{
    [Obsolete("Use CalculateWithRegion instead")]
    public decimal Calculate(decimal amount) => amount * 0.2m;

    public decimal CalculateWithRegion(decimal amount, string region) => amount * RateFor(region);

    public decimal Quote(decimal amount)
    {
        return Calculate(amount);
    }
}
`, 'deprecated-api-usage')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects WebClient construction', () => {
    const found = matches(`namespace App;
public class FeedFetcher
{
    public string Fetch(string url)
    {
        using var client = new WebClient();
        return client.DownloadString(url);
    }
}
`, 'deprecated-api-usage')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag modern HttpClient code, and leaves BinaryFormatter to the security rule', () => {
    const found = matches(`namespace App;
public class FeedFetcher
{
    private readonly HttpClient _http;

    public FeedFetcher(HttpClient http)
    {
        _http = http;
    }

    public Task<string> FetchAsync(string url) => _http.GetStringAsync(url);

    public void Snapshot(Stream stream, object state)
    {
        var formatter = new BinaryFormatter();
        formatter.Serialize(stream, state);
    }
}
`, 'deprecated-api-usage')
    expect(found).toHaveLength(0)
  })

  it('does not flag object-initializer members that share an [Obsolete] member name', () => {
    const found = matches(`namespace App;
public class OrderMigrator
{
    [Obsolete("Use StatusCode instead")]
    public int Status { get; set; }

    public int StatusCode { get; set; }

    public OrderDto Export(int code)
    {
        return new OrderDto { Status = code };
    }
}
`, 'deprecated-api-usage')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// regex-empty-group
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/regex-empty-group (C#)', () => {
  it('detects an empty group in a Regex pattern', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class OrderIdParser
{
    private static readonly Regex Pattern = new Regex(@"^ORD-()\\d+$");
}
`, 'regex-empty-group')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag populated groups or bracketed parens', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class OrderIdParser
{
    private static readonly Regex Pattern = new Regex(@"^ORD-(\\d+)[()]?$");
}
`, 'regex-empty-group')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// regex-empty-repetition
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/regex-empty-repetition (C#)', () => {
  it('detects a repeated group that can match empty', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class NumberScanner
{
    public bool Matches(string input) => Regex.IsMatch(input, @"^(\\d*)*$");
}
`, 'regex-empty-repetition')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag repeated groups whose body requires content', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class SlugValidator
{
    public bool IsValid(string slug) => Regex.IsMatch(slug, @"^[a-z0-9]+(?:[-_][a-z0-9]+)*$");
}
`, 'regex-empty-repetition')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// regex-single-char-class
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/regex-single-char-class (C#)', () => {
  it('detects a single-character class', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class VersionParser
{
    public bool IsTag(string value) => Regex.IsMatch(value, @"^[v]\\d+\\.\\d+$");
}
`, 'regex-single-char-class')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag multi-character or escaped classes', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class VersionParser
{
    public bool IsTag(string value) => Regex.IsMatch(value, @"^v[0-9]+\\.[0-9]+$");
}
`, 'regex-single-char-class')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// regex-single-char-alternation
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/regex-single-char-alternation (C#)', () => {
  it('detects alternation of single characters', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class PromptReader
{
    public bool IsChoice(string answer) => Regex.IsMatch(answer, @"^(y|n|q)$");
}
`, 'regex-single-char-alternation')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag multi-character alternatives', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class PromptReader
{
    public bool IsChoice(string answer) => Regex.IsMatch(answer, @"^(yes|no|quit)$");
}
`, 'regex-single-char-alternation')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// regex-duplicate-char-class
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/regex-duplicate-char-class (C#)', () => {
  it('detects duplicated characters in a class', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class HexValidator
{
    public bool IsHex(string value) => Regex.IsMatch(value, @"^[0-9a-fa-f]+$");
}
`, 'regex-duplicate-char-class')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag distinct class members', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class HexValidator
{
    public bool IsHex(string value) => Regex.IsMatch(value, @"^[0-9a-fA-F]+$");
}
`, 'regex-duplicate-char-class')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// regex-unused-group
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/regex-unused-group (C#)', () => {
  it('detects a named group that is never read', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class LogParser
{
    public bool IsError(string line) => Regex.IsMatch(line, @"^(?<severity>ERROR|FATAL) ");
}
`, 'regex-unused-group')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag named groups read via Groups[...]', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class LogParser
{
    private static readonly Regex LinePattern = new Regex(@"^(?<severity>[A-Z]+) (?<message>.+)$");

    public LogEntry Parse(string line)
    {
        var match = LinePattern.Match(line);
        return new LogEntry(match.Groups["severity"].Value, match.Groups["message"].Value);
    }
}
`, 'regex-unused-group')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// regex-anchor-precedence
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/regex-anchor-precedence (C#)', () => {
  it('detects an anchor that binds to only one alternative', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class CommandMatcher
{
    public bool IsStop(string command) => Regex.IsMatch(command, "^stop|halt");
}
`, 'regex-anchor-precedence')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag grouped alternations', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class CommandMatcher
{
    public bool IsStop(string command) => Regex.IsMatch(command, "^(stop|halt)$");
}
`, 'regex-anchor-precedence')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// regex-empty-alternative
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/regex-empty-alternative (C#)', () => {
  it('detects an empty alternative', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class FormatSniffer
{
    private static readonly Regex Extension = new Regex("\\\\.(csv|json|)$");
}
`, 'regex-empty-alternative')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag complete alternations', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class FormatSniffer
{
    private static readonly Regex Extension = new Regex("\\\\.(csv|json)$");
}
`, 'regex-empty-alternative')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// regex-empty-after-reluctant
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/regex-empty-after-reluctant (C#)', () => {
  it('detects an optional tail after a reluctant quantifier', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class HeaderScanner
{
    public bool HasValue(string header) => Regex.IsMatch(header, @"value=.+?;?");
}
`, 'regex-empty-after-reluctant')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag reluctant quantifiers followed by required content', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class HeaderScanner
{
    public bool HasValue(string header) => Regex.IsMatch(header, @"value=(.+?);");
}
`, 'regex-empty-after-reluctant')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// regex-multiple-spaces
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/regex-multiple-spaces (C#)', () => {
  it('detects consecutive literal spaces', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class FixedWidthParser
{
    private static readonly Regex Row = new Regex(@"^\\d+  \\w+$");
}
`, 'regex-multiple-spaces')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag quantified spaces or IgnorePatternWhitespace patterns', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class FixedWidthParser
{
    private static readonly Regex Row = new Regex(@"^\\d+ {2}\\w+$");
    private static readonly Regex Commented = new Regex(@"^\\d+  \\w+$", RegexOptions.IgnorePatternWhitespace);
}
`, 'regex-multiple-spaces')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// regex-complexity
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/regex-complexity (C#)', () => {
  it('detects an inline lookahead-heavy pattern', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class PasswordPolicy
{
    public bool IsStrong(string value)
    {
        return Regex.IsMatch(value, "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\\\d)(?=.*[#$%])[A-Za-z\\\\d#$%]{12,}$");
    }
}
`, 'regex-complexity')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a moderately-grouped pattern extracted to a named field', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class SemverParser
{
    private static readonly Regex SemverPattern = new Regex(@"^(\\d+)[.](\\d+)[.](\\d+)(?:-[0-9A-Za-z.]+)?$");
}
`, 'regex-complexity')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// regex-concise
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/regex-concise (C#)', () => {
  it('detects repeated atoms that should use a quantifier', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class PhoneValidator
{
    public bool IsLocal(string value) => Regex.IsMatch(value, @"^\\d\\d\\d-\\d\\d\\d\\d$");
}
`, 'regex-concise')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag quantified patterns, and never suggests \\d for [0-9] (.NET Unicode semantics)', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class PhoneValidator
{
    public bool IsLocal(string value) => Regex.IsMatch(value, @"^[0-9]{3}-[0-9]{4}$");
}
`, 'regex-concise')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// regex-char-class-preferred
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/regex-char-class-preferred (C#)', () => {
  it('detects a lazy dot-star where a negated class is clearer', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class TitleExtractor
{
    public Match FindTitle(string html) => Regex.Match(html, @"<title>.*?</title>");
}
`, 'regex-char-class-preferred')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag lazy dot-star under Singleline where dot must span lines', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class TitleExtractor
{
    public Match FindTitle(string html) => Regex.Match(html, @"<title>.*?</title>", RegexOptions.Singleline);
}
`, 'regex-char-class-preferred')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// regex-superfluous-quantifier
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/regex-superfluous-quantifier (C#)', () => {
  it('detects a {1} quantifier', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class PlateValidator
{
    public bool IsValid(string plate) => Regex.IsMatch(plate, @"^[A-Z]{1}\\d{4}$");
}
`, 'regex-superfluous-quantifier')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag {1,n} ranges', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class PlateValidator
{
    public bool IsValid(string plate) => Regex.IsMatch(plate, @"^[A-Z]{1,3}\\d{4}$");
}
`, 'regex-superfluous-quantifier')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// regex-unnecessary-non-capturing-group
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/regex-unnecessary-non-capturing-group (C#)', () => {
  it('detects a pointless non-capturing group', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class InvoiceMatcher
{
    public bool IsInvoiceRef(string value) => Regex.IsMatch(value, @"^(?:INV)-\\d+$");
}
`, 'regex-unnecessary-non-capturing-group')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag groups with alternation or quantifiers', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class InvoiceMatcher
{
    public bool IsReference(string value) => Regex.IsMatch(value, @"^(?:INV|ORD)-\\d+(?:-[A-Z]{2})?$");
}
`, 'regex-unnecessary-non-capturing-group')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// regex-octal-escape
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/regex-octal-escape (C#)', () => {
  it('detects an octal escape', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class TokenSplitter
{
    public string[] Split(string input) => Regex.Split(input, @"\\040+");
}
`, 'regex-octal-escape')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag hex or unicode escapes', () => {
    const found = matches(`using System.Text.RegularExpressions;
namespace App;
public class TokenSplitter
{
    public string[] Split(string input) => Regex.Split(input, @"\\x20+");
}
`, 'regex-octal-escape')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// test-empty-file
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/test-empty-file (C#)', () => {
  it('detects a [TestFixture] class with no test methods', () => {
    const found = matches(`using NUnit.Framework;
namespace App.Tests;
[TestFixture]
public class PricingServiceTests
{
    private PricingService CreateService() => new PricingService(new FakeRateProvider());
}
`, 'test-empty-file')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag fixtures with tests or unmarked helper classes', () => {
    const found = matches(`using NUnit.Framework;
namespace App.Tests;
[TestFixture]
public class PricingServiceTests
{
    [Test]
    public void AppliesTaxRate()
    {
        var service = new PricingService(new FakeRateProvider());
        Assert.AreEqual(120m, service.Total(100m));
    }
}

public class FakeRateProvider
{
    public decimal RateFor(string region) => 0.2m;
}
`, 'test-empty-file')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// test-skipped
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/test-skipped (C#)', () => {
  it('detects xUnit Skip and NUnit [Ignore]', () => {
    const found = matches(`using Xunit;
namespace App.Tests;
public class CheckoutTests
{
    [Fact(Skip = "flaky on CI, see #482")]
    public void CompletesCheckout()
    {
        Assert.True(new CheckoutFlow().Complete());
    }

    [Ignore("waiting for payment sandbox")]
    public void RefundsDeposit()
    {
        Assert.True(new CheckoutFlow().Refund());
    }
}
`, 'test-skipped')
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('does not flag active tests', () => {
    const found = matches(`using Xunit;
namespace App.Tests;
public class CheckoutTests
{
    [Fact]
    public void CompletesCheckout()
    {
        Assert.True(new CheckoutFlow().Complete());
    }
}
`, 'test-skipped')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// test-missing-assertion
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/test-missing-assertion (C#)', () => {
  it('detects a test without any assertion', () => {
    const found = matches(`using Xunit;
namespace App.Tests;
public class InviteServiceTests
{
    [Fact]
    public async Task SendsInvite()
    {
        var service = new InviteService(new FakeMailer());
        await service.SendAsync("user@acme.test");
    }
}
`, 'test-missing-assertion')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag tests using Assert, FluentAssertions, or mock verification', () => {
    const found = matches(`using Xunit;
namespace App.Tests;
public class InviteServiceTests
{
    [Fact]
    public async Task SendsInvite()
    {
        var mailer = new FakeMailer();
        var service = new InviteService(mailer);
        await service.SendAsync("user@acme.test");
        Assert.Single(mailer.Sent);
    }

    [Fact]
    public void ComputesTotal()
    {
        var total = new Cart().Add(10m).Add(5m).Total;
        total.Should().Be(15m);
    }
}
`, 'test-missing-assertion')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// test-same-argument
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/test-same-argument (C#)', () => {
  it('detects an assertion comparing a value to itself', () => {
    const found = matches(`using Xunit;
namespace App.Tests;
public class OrderTotalTests
{
    [Fact]
    public void TotalsMatch()
    {
        var order = OrderFactory.WithLines(3);
        Assert.Equal(order.Total, order.Total);
    }
}
`, 'test-same-argument')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag assertions with distinct expected and actual', () => {
    const found = matches(`using Xunit;
namespace App.Tests;
public class OrderTotalTests
{
    [Fact]
    public void TotalsMatch()
    {
        var order = OrderFactory.WithLines(3);
        Assert.Equal(expectedTotal, order.Total);
    }
}
`, 'test-same-argument')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// test-inverted-arguments
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/test-inverted-arguments (C#)', () => {
  it('detects a literal in the actual position', () => {
    const found = matches(`using Xunit;
namespace App.Tests;
public class InvoiceTests
{
    [Fact]
    public void CountsLines()
    {
        var invoice = InvoiceFactory.WithLines(3);
        Assert.Equal(invoice.Lines.Count, 3);
    }
}
`, 'test-inverted-arguments')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag expected-first assertions', () => {
    const found = matches(`using Xunit;
namespace App.Tests;
public class InvoiceTests
{
    [Fact]
    public void CountsLines()
    {
        var invoice = InvoiceFactory.WithLines(3);
        Assert.Equal(3, invoice.Lines.Count);
    }
}
`, 'test-inverted-arguments')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// test-missing-exception-check
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/test-missing-exception-check (C#)', () => {
  it('detects a discarded base-Exception assertion', () => {
    const found = matches(`using Xunit;
namespace App.Tests;
public class FeeCalculatorTests
{
    [Fact]
    public void RejectsNegativeAmounts()
    {
        var calculator = new FeeCalculator();
        Assert.ThrowsAny<Exception>(() => calculator.Apply(-5m));
    }
}
`, 'test-missing-exception-check')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag concrete exception types or captured results', () => {
    const found = matches(`using Xunit;
namespace App.Tests;
public class FeeCalculatorTests
{
    [Fact]
    public void RejectsNegativeAmounts()
    {
        var calculator = new FeeCalculator();
        Assert.Throws<ArgumentOutOfRangeException>(() => calculator.Apply(-5m));
        var ex = Assert.ThrowsAny<Exception>(() => calculator.Apply(decimal.MinValue));
        Assert.Contains("amount", ex.Message);
    }
}
`, 'test-missing-exception-check')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// test-with-hardcoded-timeout
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/test-with-hardcoded-timeout (C#)', () => {
  it('detects Task.Delay inside a test', () => {
    const found = matches(`using Xunit;
namespace App.Tests;
public class QueueProcessorTests
{
    [Fact]
    public async Task DrainsQueue()
    {
        var processor = new QueueProcessor();
        processor.Enqueue(new Job("import"));
        await Task.Delay(2000);
        Assert.True(processor.IsIdle);
    }
}
`, 'test-with-hardcoded-timeout')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag Task.Delay in production retry code', () => {
    const found = matches(`namespace App;
public class RetryingClient
{
    public async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var response = await _http.SendAsync(request);
            if (response.IsSuccessStatusCode) return response;
            await Task.Delay(TimeSpan.FromSeconds(Math.Pow(2, attempt)));
        }
        throw new RetriesExhaustedException();
    }
}
`, 'test-with-hardcoded-timeout')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// disabled-test-timeout
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/disabled-test-timeout (C#)', () => {
  it('detects an excessive NUnit timeout and a disabled xUnit timeout', () => {
    const found = matches(`using NUnit.Framework;
namespace App.Tests;
public class SyncJobTests
{
    [Test, Timeout(600000)]
    public void SyncsEverything()
    {
        Assert.That(new SyncJob().RunAll(), Is.True);
    }
}
`, 'disabled-test-timeout')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag reasonable timeouts', () => {
    const found = matches(`using NUnit.Framework;
namespace App.Tests;
public class SyncJobTests
{
    [Test, Timeout(5000)]
    public void SyncsOneBatch()
    {
        Assert.That(new SyncJob().RunBatch(1), Is.True);
    }
}
`, 'disabled-test-timeout')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// flaky-test
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/flaky-test (C#)', () => {
  it('detects wall-clock assertions and seedless Random in tests', () => {
    const found = matches(`using Xunit;
namespace App.Tests;
public class ReportSchedulerTests
{
    [Fact]
    public void StampsGenerationTime()
    {
        var report = new ReportScheduler().Generate();
        Assert.True(report.GeneratedAt <= DateTime.UtcNow);
    }

    [Fact]
    public void HandlesArbitraryAmounts()
    {
        var random = new Random();
        var amount = random.Next(1, 1000);
        Assert.True(new FeeCalculator().Apply(amount) >= 0);
    }
}
`, 'flaky-test')
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('does not flag UtcNow used to build test data or a seeded Random', () => {
    const found = matches(`using Xunit;
namespace App.Tests;
public class ReportSchedulerTests
{
    [Fact]
    public void StampsGenerationTime()
    {
        var startedAt = DateTime.UtcNow;
        var report = new ReportScheduler().GenerateAt(startedAt);
        Assert.Equal(startedAt, report.GeneratedAt);
    }

    [Fact]
    public void HandlesArbitraryAmounts()
    {
        var random = new Random(42);
        var amount = random.Next(1, 1000);
        Assert.True(new FeeCalculator().Apply(amount) >= 0);
    }
}
`, 'flaky-test')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// test-modifying-global-state
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/test-modifying-global-state (C#)', () => {
  it('detects a test assigning an unmanaged static field', () => {
    const found = matches(`using Xunit;
namespace App.Tests;
public class RateLimiterTests
{
    private static int _requestCount;

    [Fact]
    public void CountsRequests()
    {
        _requestCount = 0;
        var limiter = new RateLimiter();
        limiter.Allow("client-a");
        Assert.Equal(0, _requestCount);
    }
}
`, 'test-modifying-global-state')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag instance fields or statics reset in a lifecycle hook', () => {
    const found = matches(`using NUnit.Framework;
namespace App.Tests;
public class RateLimiterTests
{
    private static int _requestCount;
    private RateLimiter _limiter;

    [SetUp]
    public void SetUp()
    {
        _requestCount = 0;
        _limiter = new RateLimiter();
    }

    [Test]
    public void CountsRequests()
    {
        _requestCount = 1;
        _limiter = new RateLimiter();
        Assert.AreEqual(1, _requestCount);
    }
}
`, 'test-modifying-global-state')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// accessor-pairs
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/accessor-pairs (C#)', () => {
  it('detects a write-only property', () => {
    const found = matches(`namespace App;
public class DatabaseOptions
{
    private string _connectionString;

    public string ConnectionString
    {
        set { _connectionString = value; }
    }
}
`, 'accessor-pairs')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag read/write, init-only, or expression-bodied properties', () => {
    const found = matches(`namespace App;
public class DatabaseOptions
{
    private readonly int _poolSize = 10;

    public string ConnectionString { get; set; }
    public string Provider { get; init; }
    public int PoolSize => _poolSize;
}
`, 'accessor-pairs')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// ban-ts-comment (#pragma warning disable)
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/ban-ts-comment (C#)', () => {
  it('detects #pragma warning disable without justification', () => {
    const found = matches(`#pragma warning disable CA1031
namespace App;
public class Worker
{
    public void Run()
    {
        try { Execute(); } catch (Exception) { }
    }

    private void Execute() { }
}
`, 'ban-ts-comment')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag justified suppressions or restores', () => {
    const found = matches(`#pragma warning disable CA1031 // worker loop must never crash the host
namespace App;
public class Worker
{
    public void Run()
    {
        // suppressing the obsolete-API warning until the v2 SDK migration
#pragma warning disable CS0618
        LegacyClient.Connect();
#pragma warning restore CS0618
    }
}
`, 'ban-ts-comment')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// bitwise-in-boolean
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/bitwise-in-boolean (C#)', () => {
  it('detects & between comparison results in a condition', () => {
    const found = matches(`namespace App;
public class OrderGate
{
    public void Review(Order order, decimal expected)
    {
        if (order.Quantity > 0 & order.Price == expected)
        {
            Approve(order);
        }
    }

    private void Approve(Order order) { }
}
`, 'bitwise-in-boolean')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag flag masking or deliberate non-short-circuit booleans', () => {
    const found = matches(`namespace App;
public class AccessControl
{
    public void Check(int flags, bool isValid, bool hasAccess, Order order)
    {
        var masked = flags & 0x0F;
        if (isValid & hasAccess)
        {
            Grant();
        }
        if (order.Quantity > 0 && order.Price > 0m)
        {
            Approve(order);
        }
    }

    private void Grant() { }
    private void Approve(Order order) { }
}
`, 'bitwise-in-boolean')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// empty-static-block (static constructor)
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/empty-static-block (C#)', () => {
  it('detects an empty static constructor', () => {
    const found = matches(`namespace App;
public class MetricsRegistry
{
    static MetricsRegistry()
    {
    }

    public static void Register(string name) { }
}
`, 'empty-static-block')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a static constructor that initializes state', () => {
    const found = matches(`namespace App;
public class MetricsRegistry
{
    public static Dictionary<string, string> DefaultTags;

    static MetricsRegistry()
    {
        DefaultTags = new Dictionary<string, string> { ["host"] = Environment.MachineName };
    }
}
`, 'empty-static-block')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// env-in-library-code
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/env-in-library-code (C#)', () => {
  it('detects env access in domain code', () => {
    const found = matchesAt('/src/Billing/InvoiceCalculator.cs', `namespace App.Billing;
public class InvoiceCalculator
{
    public decimal VatRate()
    {
        var rate = Environment.GetEnvironmentVariable("VAT_RATE") ?? "0.2";
        return decimal.Parse(rate);
    }
}
`, 'env-in-library-code')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag the composition root or configuration classes', () => {
    const program = matchesAt('/src/Program.cs', `var urls = Environment.GetEnvironmentVariable("ASPNETCORE_URLS") ?? "http://localhost:5000";
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls(urls);
builder.Build().Run();
`, 'env-in-library-code')
    expect(program).toHaveLength(0)

    const options = matchesAt('/src/Configuration/StorageSettings.cs', `namespace App.Configuration;
public class StorageSettings
{
    public static StorageSettings Load()
    {
        return new StorageSettings { Bucket = Environment.GetEnvironmentVariable("STORAGE_BUCKET") ?? "default" };
    }

    public string Bucket { get; set; }
}
`, 'env-in-library-code')
    expect(options).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// filename-class-mismatch
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/filename-class-mismatch (C#)', () => {
  it('detects a single public type that does not match the file name', () => {
    const found = matchesAt('/src/Services/PaymentService.cs', `namespace App.Services;
public class StripeGateway
{
    public void Charge(decimal amount) { }
}
`, 'filename-class-mismatch')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag matching names, internal helpers, or partial classes', () => {
    const matching = matchesAt('/src/Services/PaymentService.cs', `namespace App.Services;
public class PaymentService
{
    public void Charge(decimal amount) { }
}

internal class StripeRequestSigner
{
    public string Sign(string payload) => payload;
}
`, 'filename-class-mismatch')
    expect(matching).toHaveLength(0)

    const partial = matchesAt('/src/Services/OrderService.Validation.cs', `namespace App.Services;
public partial class OrderService
{
    public void Validate(Order order) { }
}
`, 'filename-class-mismatch')
    expect(partial).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// filter-first-over-find
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/filter-first-over-find (C#)', () => {
  it('detects Where(pred).First()', () => {
    const found = matches(`namespace App;
public class OrderQueries
{
    public Order FirstActive(IEnumerable<Order> orders)
    {
        return orders.Where(o => o.Status == OrderStatus.Active).First();
    }
}
`, 'filter-first-over-find')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag First(pred), projection pipelines, or indexed Where', () => {
    const found = matches(`namespace App;
public class OrderQueries
{
    public Order FirstActive(IEnumerable<Order> orders)
    {
        return orders.First(o => o.Status == OrderStatus.Active);
    }

    public List<int> ActiveIds(IEnumerable<Order> orders)
    {
        return orders.Where(o => o.Status == OrderStatus.Active).Select(o => o.Id).ToList();
    }

    public Order FirstEven(IEnumerable<Order> orders)
    {
        return orders.Where((o, i) => i % 2 == 0).First();
    }
}
`, 'filter-first-over-find')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// indexed-loop-over-for-of
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/indexed-loop-over-for-of (C#)', () => {
  it('detects an indexed loop whose index is only used for element reads', () => {
    const found = matches(`namespace App;
public class ReportPrinter
{
    public void PrintAll(List<string> lines)
    {
        for (int i = 0; i < lines.Count; i++)
        {
            Render(lines[i]);
        }
    }

    private void Render(string line) { }
}
`, 'indexed-loop-over-for-of')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag loops that write elements or use the index beyond access', () => {
    const found = matches(`namespace App;
public class SignalProcessor
{
    public void Amplify(int[] samples)
    {
        for (int i = 0; i < samples.Length; i++)
        {
            samples[i] = samples[i] * 2;
        }
    }

    public void Tag(List<string> lines)
    {
        for (int i = 0; i < lines.Count; i++)
        {
            Render(i, lines[i]);
        }
    }

    private void Render(int index, string line) { }
}
`, 'indexed-loop-over-for-of')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// labels-usage
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/labels-usage (C#)', () => {
  it('detects goto to a label', () => {
    const found = matches(`namespace App;
public class QueueDrainer
{
    public int Drain(Queue<Job> jobs)
    {
        var processed = 0;
    retry:
        if (jobs.Count > 0)
        {
            Process(jobs.Dequeue());
            processed++;
            goto retry;
        }
        return processed;
    }

    private void Process(Job job) { }
}
`, 'labels-usage')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag goto case / goto default inside a switch', () => {
    const found = matches(`namespace App;
public class ConnectionStateMachine
{
    public void Advance(int state)
    {
        switch (state)
        {
            case 0:
                Open();
                goto case 1;
            case 1:
                Send();
                goto default;
            default:
                break;
        }
    }

    private void Open() { }
    private void Send() { }
}
`, 'labels-usage')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// misleading-same-line-conditional
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/misleading-same-line-conditional (C#)', () => {
  it('detects two if statements on one line', () => {
    const found = matches(`namespace App;
public class TriageQueue
{
    public void Triage(Order order, Queue queue)
    {
        if (order.IsRush) queue.Promote(order); if (order.IsFragile) queue.MarkFragile(order);
    }
}
`, 'misleading-same-line-conditional')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag consecutive guards on separate lines', () => {
    const found = matches(`namespace App;
public class TriageQueue
{
    public void Triage(Order order, Queue queue)
    {
        if (order.IsRush) queue.Promote(order);
        if (order.IsFragile) queue.MarkFragile(order);
    }
}
`, 'misleading-same-line-conditional')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// missing-env-validation
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/missing-env-validation (C#)', () => {
  it('detects dereferencing the raw GetEnvironmentVariable result', () => {
    const found = matches(`namespace App;
public class LoggingSetup
{
    public string[] Levels()
    {
        return Environment.GetEnvironmentVariable("LOG_LEVELS").Split(',');
    }
}
`, 'missing-env-validation')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag null-conditional access or coalesced defaults', () => {
    const found = matches(`namespace App;
public class LoggingSetup
{
    public string[] Levels()
    {
        return Environment.GetEnvironmentVariable("LOG_LEVELS")?.Split(',') ?? Array.Empty<string>();
    }

    public string ConnectionString()
    {
        return Environment.GetEnvironmentVariable("DB_CONN") ?? "Host=localhost";
    }
}
`, 'missing-env-validation')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// multiline-block-without-braces
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/multiline-block-without-braces (C#)', () => {
  it('detects misleading indentation after a braceless body', () => {
    const found = matches(`namespace App;
public class MessageSender
{
    public void Send(Message message)
    {
        if (message.RequiresRetry)
            Reconnect();
            Resend(message);
    }

    private void Reconnect() { }
    private void Resend(Message message) { }
}
`, 'multiline-block-without-braces')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag the accepted braceless guard style', () => {
    const found = matches(`namespace App;
public class MessageSender
{
    public void Send(Message message)
    {
        if (message == null)
            return;
        Dispatch(message);
    }

    private void Dispatch(Message message) { }
}
`, 'multiline-block-without-braces')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// mutable-private-member
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/mutable-private-member (C#)', () => {
  it('detects a private field assigned only in the constructor', () => {
    const found = matches(`namespace App;
public class OrderService
{
    private IOrderRepository _repository;

    public OrderService(IOrderRepository repository)
    {
        _repository = repository;
    }

    public Order Find(int id)
    {
        return _repository.GetById(id);
    }
}
`, 'mutable-private-member')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag fields mutated outside the constructor or already readonly', () => {
    const found = matches(`namespace App;
public class RetryPolicy
{
    private readonly TimeSpan _delay = TimeSpan.FromSeconds(1);
    private int _attempts;
    private HttpClient _client;

    public bool ShouldRetry()
    {
        _attempts++;
        return _attempts < 3;
    }

    public void Reset()
    {
        _client = new HttpClient();
    }
}
`, 'mutable-private-member')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// nested-template-literal
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/nested-template-literal (C#)', () => {
  it('detects an interpolated string inside an interpolation hole', () => {
    const found = matches(`namespace App;
public class AlertFormatter
{
    public string Format(Order order, bool urgent)
    {
        return $"Order {(urgent ? $"URGENT-{order.Id}" : order.Id.ToString())} queued";
    }
}
`, 'nested-template-literal')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag flat interpolation', () => {
    const found = matches(`namespace App;
public class AlertFormatter
{
    public string Format(Order order)
    {
        var prefix = order.IsUrgent ? "URGENT-" : "";
        return $"Order {prefix}{order.Id} queued";
    }
}
`, 'nested-template-literal')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// non-null-assertion
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/non-null-assertion (C#)', () => {
  it('detects the null-forgiving operator on a dereferenced expression', () => {
    const found = matches(`namespace App;
public class UserDirectory
{
    private readonly IUserRepository _repository;

    public string GetEmail(int id)
    {
        var user = _repository.Find(id);
        return user!.Email;
    }
}
`, 'non-null-assertion')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag the null!/default! initializer idiom', () => {
    const found = matches(`namespace App;
public class CreateOrderRequest
{
    public string CustomerId { get; set; } = null!;
    public List<OrderLine> Lines { get; set; } = default!;
}
`, 'non-null-assertion')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// prefer-immediate-return
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/prefer-immediate-return (C#)', () => {
  it('detects a variable declared and immediately returned', () => {
    const found = matches(`namespace App;
public class InvoiceTotals
{
    public decimal Total(Order order)
    {
        var total = order.Lines.Sum(l => l.Price * l.Quantity);
        return total;
    }
}
`, 'prefer-immediate-return')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a variable used between declaration and return', () => {
    const found = matches(`namespace App;
public class InvoiceTotals
{
    public decimal Total(Order order)
    {
        var total = order.Lines.Sum(l => l.Price * l.Quantity);
        if (total < 0) throw new InvalidOperationException("Negative total");
        return total;
    }
}
`, 'prefer-immediate-return')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// prefer-includes
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/prefer-includes (C#)', () => {
  it('detects IndexOf(x) >= 0 as an existence test', () => {
    const found = matches(`namespace App;
public class TagFilter
{
    public bool IsUrgent(List<string> tags)
    {
        return tags.IndexOf("urgent") >= 0;
    }
}
`, 'prefer-includes')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag Contains, startIndex overloads, or position uses', () => {
    const found = matches(`namespace App;
public class TagFilter
{
    public bool IsUrgent(List<string> tags)
    {
        return tags.Contains("urgent");
    }

    public bool HasLateMarker(string label)
    {
        return label.IndexOf('!', 3) >= 0;
    }

    public string Domain(string email)
    {
        var at = email.IndexOf('@');
        return at >= 0 ? email.Substring(at + 1) : email;
    }
}
`, 'prefer-includes')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// prefer-optional-chain
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/prefer-optional-chain (C#)', () => {
  it('detects chained null checks collapsible to ?.', () => {
    const found = matches(`namespace App;
public class ShippingRules
{
    public bool HasAddress(Order order)
    {
        return order != null && order.Customer != null;
    }
}
`, 'prefer-optional-chain')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag guards over bool members or unrelated operands', () => {
    const found = matches(`namespace App;
public class ShippingRules
{
    public bool IsPriority(Order order)
    {
        return order != null && order.IsPriority;
    }

    public bool BothPresent(Order order, Customer customer)
    {
        return order != null && customer.Profile != null;
    }
}
`, 'prefer-optional-chain')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// prefer-template
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/prefer-template (C#)', () => {
  it('detects long + concatenation mixing literals and values', () => {
    const found = matches(`namespace App;
public class RetryReporter
{
    public string Describe(int orderId, int attempts)
    {
        return "Order " + orderId + " failed after " + attempts + " attempts";
    }
}
`, 'prefer-template')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag short concatenation or const contexts', () => {
    const found = matches(`namespace App;
public class ApiRoutes
{
    private const string Host = "api.internal";
    private const string Version = "v2";
    private const string BaseUrl = "https://" + Host + "/" + Version + "/";

    public string Greeting(string name)
    {
        return "Hello " + name;
    }
}
`, 'prefer-template')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// prefer-while
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/prefer-while (C#)', () => {
  it('detects for(;cond;) with no initializer or update', () => {
    const found = matches(`namespace App;
public class OutboxFlusher
{
    public void FlushAll(Queue<Message> pending)
    {
        for (; pending.Count > 0;)
        {
            Flush(pending.Dequeue());
        }
    }

    private void Flush(Message message) { }
}
`, 'prefer-while')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag counted loops or while loops', () => {
    const found = matches(`namespace App;
public class OutboxFlusher
{
    public void FlushBatch(Queue<Message> pending, int batchSize)
    {
        for (int i = 0; i < batchSize; i++)
        {
            if (pending.Count == 0) break;
            Flush(pending.Dequeue());
        }
        while (pending.Count > 0)
        {
            Flush(pending.Dequeue());
        }
    }

    private void Flush(Message message) { }
}
`, 'prefer-while')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// substring-over-starts-ends
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/substring-over-starts-ends (C#)', () => {
  it('detects Substring(0, n) compared to a literal', () => {
    const found = matches(`namespace App;
public class RouteClassifier
{
    public bool IsApiRoute(string route)
    {
        return route.Substring(0, 4) == "/api";
    }
}
`, 'substring-over-starts-ends')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag StartsWith or non-prefix substrings', () => {
    const found = matches(`namespace App;
public class RouteClassifier
{
    public bool IsApiRoute(string route)
    {
        return route.StartsWith("/api");
    }

    public string StripLeadingSlash(string route)
    {
        return route.Substring(1);
    }

    public bool MatchesPrefix(string route, string prefix)
    {
        return route.Substring(0, prefix.Length) == prefix;
    }
}
`, 'substring-over-starts-ends')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unnamed-regex-capture
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unnamed-regex-capture (C#)', () => {
  it('detects 3+ unnamed capture groups', () => {
    const found = matches(`namespace App;
public class LogLineParser
{
    public Match ParseDate(string line)
    {
        return Regex.Match(line, @"(\\d{4})-(\\d{2})-(\\d{2})");
    }
}
`, 'unnamed-regex-capture')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag named groups or few captures', () => {
    const found = matches(`namespace App;
public class LogLineParser
{
    public Match ParseDate(string line)
    {
        return Regex.Match(line, @"(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})");
    }

    public Match ParsePair(string line)
    {
        return Regex.Match(line, @"(\\w+)=(\\w+)");
    }
}
`, 'unnamed-regex-capture')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unnecessary-block
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unnecessary-block (C#)', () => {
  it('detects a bare block with no declarations', () => {
    const found = matches(`namespace App;
public class OrderFinalizer
{
    public void Complete(Order order)
    {
        Validate(order);
        {
            Archive(order);
            Notify(order);
        }
    }

    private void Validate(Order order) { }
    private void Archive(Order order) { }
    private void Notify(Order order) { }
}
`, 'unnecessary-block')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag blocks used to scope locals', () => {
    const found = matches(`namespace App;
public class SnapshotComparer
{
    public void CompareTwice(Store store)
    {
        {
            var snapshot = store.TakeSnapshot();
            Verify(snapshot);
        }
        {
            var snapshot = store.TakeSnapshot();
            Verify(snapshot);
        }
    }

    private void Verify(Snapshot snapshot) { }
}
`, 'unnecessary-block')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unread-private-attribute
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unread-private-attribute (C#)', () => {
  it('detects a private field that is written but never read', () => {
    const found = matches(`namespace App;
public class SyncJob
{
    private DateTime _lastRunAt;

    public void Run()
    {
        Execute();
        _lastRunAt = DateTime.UtcNow;
    }

    private void Execute() { }
}
`, 'unread-private-attribute')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag fields that are read or compound-assigned', () => {
    const found = matches(`namespace App;
public class SyncJob
{
    private DateTime _lastRunAt;
    private int _runCount;

    public void Run()
    {
        _lastRunAt = DateTime.UtcNow;
        _runCount++;
    }

    public TimeSpan SinceLastRun()
    {
        return DateTime.UtcNow - _lastRunAt;
    }
}
`, 'unread-private-attribute')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unused-constructor-result
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unused-constructor-result (C#)', () => {
  it('detects a discarded constructor result', () => {
    const found = matches(`namespace App;
public class OrderIntake
{
    public void Accept(OrderRequest request)
    {
        new OrderValidator(request);
        Save(request);
    }

    private void Save(OrderRequest request) { }
}
`, 'unused-constructor-result')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag assigned results or out-parameter constructors', () => {
    const found = matches(`namespace App;
public class OrderIntake
{
    public void Accept(OrderRequest request)
    {
        var validator = new OrderValidator(request);
        validator.Validate();
        new Mutex(true, "Global\\\\OrderIntake", out var createdNew);
    }
}
`, 'unused-constructor-result')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// useless-concat
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/useless-concat (C#)', () => {
  it('detects adjacent string literals in a mixed concatenation', () => {
    const found = matches(`namespace App;
public class HeaderBuilder
{
    public string CorrelationHeader(string requestId)
    {
        return "X-" + "Correlation-Id: " + requestId;
    }
}
`, 'useless-concat')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag multi-line all-literal concatenation', () => {
    const found = matches(`namespace App;
public class CliHelp
{
    public string Usage()
    {
        return "truecourse import tool\\n" +
            "Usage: import <file>\\n" +
            "Options: --dry-run";
    }
}
`, 'useless-concat')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// useless-escape
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/useless-escape (C#)', () => {
  it("detects \\' inside a string literal", () => {
    const found = matches(`namespace App;
public class StatusMessages
{
    public string Ready()
    {
        return "It\\'s ready";
    }
}
`, 'useless-escape')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag required escapes', () => {
    const found = matches(`namespace App;
public class StatusMessages
{
    public string Compose()
    {
        var path = "C:\\\\temp\\\\out.txt";
        var quoted = "say \\"hi\\"";
        var apostrophe = '\\'';
        return path + quoted + apostrophe;
    }
}
`, 'useless-escape')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// ambiguous-unicode-character
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/ambiguous-unicode-character (C#)', () => {
  it('detects a confusable character mixed into a Latin identifier', () => {
    const found = matches(`namespace App;
public class InventoryReport
{
    public int Summarize(List<Order> orders)
    {
        var orderCоunt = orders.Count;
        return orderCоunt;
    }
}
`, 'ambiguous-unicode-character')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag ASCII identifiers, localized strings, or single-script identifiers', () => {
    const found = matches(`namespace App;
public class InventoryReport
{
    public string Summarize(List<Order> orders)
    {
        var orderCount = orders.Count;
        var статус = "загружено";
        return $"{статус}: {orderCount}";
    }
}
`, 'ambiguous-unicode-character')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// broad-exception-raised
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/broad-exception-raised (C#)', () => {
  it('detects throw new Exception', () => {
    const found = matches(`namespace App;
public class InventorySync
{
    public void Sync(Warehouse warehouse)
    {
        if (!warehouse.IsReachable)
        {
            throw new Exception("Inventory sync failed");
        }
    }
}
`, 'broad-exception-raised')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag specific exception types or bare rethrows', () => {
    const found = matches(`namespace App;
public class InventorySync
{
    public void Sync(Warehouse warehouse)
    {
        if (!warehouse.IsReachable)
        {
            throw new InvalidOperationException("Warehouse is unreachable");
        }
        try
        {
            Push(warehouse);
        }
        catch (TimeoutException)
        {
            throw;
        }
    }

    private void Push(Warehouse warehouse) { }
}
`, 'broad-exception-raised')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// compare-to-empty-string
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/compare-to-empty-string (C#)', () => {
  it('detects comparison against ""', () => {
    const found = matches(`namespace App;
public class CustomerValidator
{
    public bool HasEmail(Customer customer)
    {
        return customer.Email != "";
    }
}
`, 'compare-to-empty-string')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag IsNullOrEmpty, Length checks, or null comparison', () => {
    const found = matches(`namespace App;
public class CustomerValidator
{
    public bool HasEmail(Customer customer)
    {
        return !string.IsNullOrEmpty(customer.Email);
    }

    public bool HasName(Customer customer)
    {
        return customer.Name != null && customer.Name.Length != 0;
    }
}
`, 'compare-to-empty-string')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// deeply-nested-fstring
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/deeply-nested-fstring (C#)', () => {
  it('detects interpolation nested 3 levels deep', () => {
    const found = matches(`namespace App;
public class DeploySummary
{
    public string Describe(string env, string service, int major, int minor)
    {
        return $"Deploy {env}: {$"{service} {$"v{major}.{minor}"}"}";
    }
}
`, 'deeply-nested-fstring')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag single-level nesting (owned by nested-template-literal)', () => {
    const found = matches(`namespace App;
public class DeploySummary
{
    public string Label(int id)
    {
        return $"Order {$"#{id}"}";
    }
}
`, 'deeply-nested-fstring')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// eq-without-hash
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/eq-without-hash (C#)', () => {
  it('detects Equals override without GetHashCode', () => {
    const found = matches(`namespace App;
public class Money
{
    public decimal Amount { get; }
    public string Currency { get; }

    public override bool Equals(object? obj)
    {
        return obj is Money other && other.Amount == Amount && other.Currency == Currency;
    }
}
`, 'eq-without-hash')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag types overriding both members', () => {
    const found = matches(`namespace App;
public class Money
{
    public decimal Amount { get; }
    public string Currency { get; }

    public override bool Equals(object? obj)
    {
        return obj is Money other && other.Amount == Amount && other.Currency == Currency;
    }

    public override int GetHashCode()
    {
        return HashCode.Combine(Amount, Currency);
    }
}
`, 'eq-without-hash')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// error-instead-of-exception
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/error-instead-of-exception (C#)', () => {
  it('detects an exception type named *Error', () => {
    const found = matches(`namespace App;
public class PaymentDeclinedError : Exception
{
    public PaymentDeclinedError(string message) : base(message) { }
}
`, 'error-instead-of-exception')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag *Exception types or non-exception Error classes', () => {
    const found = matches(`namespace App;
public class PaymentDeclinedException : Exception
{
    public PaymentDeclinedException(string message) : base(message) { }
}

public class ValidationError
{
    public string Field { get; set; }
    public string Message { get; set; }
}
`, 'error-instead-of-exception')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// if-else-instead-of-ternary
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/if-else-instead-of-ternary (C#)', () => {
  it('detects an if/else that only assigns the same target', () => {
    const found = matches(`namespace App;
public class ShippingCalculator
{
    public decimal Quote(Order order, decimal threshold, decimal standardRate)
    {
        decimal shipping;
        if (order.Total >= threshold)
        {
            shipping = 0m;
        }
        else
        {
            shipping = standardRate;
        }
        return shipping;
    }
}
`, 'if-else-instead-of-ternary')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag multi-statement branches or the min/max shape', () => {
    const found = matches(`namespace App;
public class ShippingCalculator
{
    public decimal Quote(Order order, decimal threshold, decimal standardRate)
    {
        decimal shipping;
        if (order.Total >= threshold)
        {
            shipping = 0m;
            order.FreeShipping = true;
        }
        else
        {
            shipping = standardRate;
        }
        return shipping;
    }

    public int Widest(int left, int right)
    {
        int widest;
        if (left > right)
        {
            widest = left;
        }
        else
        {
            widest = right;
        }
        return widest;
    }
}
`, 'if-else-instead-of-ternary')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// if-expr-min-max
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/if-expr-min-max (C#)', () => {
  it('detects a hand-rolled minimum', () => {
    const found = matches(`namespace App;
public class BatchSizer
{
    public int NextBatch(int remaining, int batchSize)
    {
        var take = remaining < batchSize ? remaining : batchSize;
        return take;
    }
}
`, 'if-expr-min-max')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag Math.Min or unrelated ternaries', () => {
    const found = matches(`namespace App;
public class BatchSizer
{
    public int NextBatch(int remaining, int batchSize)
    {
        return Math.Min(remaining, batchSize);
    }

    public decimal Fee(decimal total)
    {
        return total > 100m ? 0m : 5m;
    }
}
`, 'if-expr-min-max')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// len-test
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/len-test (C#)', () => {
  it('detects Count() == 0 as an emptiness test', () => {
    const found = matches(`namespace App;
public class OrderDispatcher
{
    public void Dispatch(IEnumerable<Order> pendingOrders)
    {
        if (pendingOrders.Count() == 0)
        {
            return;
        }
        Send(pendingOrders);
    }

    private void Send(IEnumerable<Order> orders) { }
}
`, 'len-test')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag the Count property or Any()', () => {
    const found = matches(`namespace App;
public class OrderDispatcher
{
    public void Dispatch(List<Order> pendingOrders)
    {
        if (pendingOrders.Count == 0)
        {
            return;
        }
        if (!pendingOrders.Any(o => o.IsRush))
        {
            Defer(pendingOrders);
        }
        var total = pendingOrders.Count();
        Send(pendingOrders, total);
    }

    private void Defer(List<Order> orders) { }
    private void Send(List<Order> orders, int total) { }
}
`, 'len-test')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// logging-string-format
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/logging-string-format (C#)', () => {
  it('detects an interpolated string passed to ILogger', () => {
    const found = matches(`namespace App;
public class ShipmentService
{
    private readonly ILogger<ShipmentService> _logger;

    public void Ship(int orderId, string address)
    {
        _logger.LogInformation($"Order {orderId} shipped to {address}");
    }
}
`, 'logging-string-format')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag structured message templates', () => {
    const found = matches(`namespace App;
public class ShipmentService
{
    private readonly ILogger<ShipmentService> _logger;

    public void Ship(int orderId, string address)
    {
        _logger.LogInformation("Order {OrderId} shipped to {Address}", orderId, address);
        _logger.LogWarning("Carrier unavailable, falling back to default");
    }
}
`, 'logging-string-format')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// non-augmented-assignment
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/non-augmented-assignment (C#)', () => {
  it('detects x = x + 1', () => {
    const found = matches(`namespace App;
public class RetryLoop
{
    public void Execute(Action action, int maxAttempts)
    {
        var attempts = 0;
        while (attempts < maxAttempts)
        {
            attempts = attempts + 1;
            action();
        }
    }
}
`, 'non-augmented-assignment')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag compound assignment or unrelated arithmetic', () => {
    const found = matches(`namespace App;
public class RetryLoop
{
    public decimal Execute(decimal subtotal, decimal tax, int maxAttempts)
    {
        var attempts = 0;
        decimal total = 0m;
        while (attempts < maxAttempts)
        {
            attempts += 1;
            total = subtotal + tax;
        }
        return total;
    }
}
`, 'non-augmented-assignment')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// raise-within-try
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/raise-within-try (C#)', () => {
  it('detects a throw swallowed by its own catch-all', () => {
    const found = matches(`namespace App;
public class ConfigApplier
{
    private readonly ILogger _logger;

    public void Apply(ServiceConfig config)
    {
        try
        {
            if (config == null)
            {
                throw new InvalidOperationException("Configuration was not loaded");
            }
            ApplyCore(config);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to apply configuration");
        }
    }

    private void ApplyCore(ServiceConfig config) { }
}
`, 'raise-within-try')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag rethrowing catches or non-matching catch types', () => {
    const found = matches(`namespace App;
public class ConfigApplier
{
    private readonly ILogger _logger;

    public void Apply(ServiceConfig config)
    {
        try
        {
            if (config == null)
            {
                throw new InvalidOperationException("Configuration was not loaded");
            }
            ApplyCore(config);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to apply configuration");
            throw;
        }
    }

    public void Reload(ServiceConfig config)
    {
        try
        {
            if (config == null)
            {
                throw new InvalidOperationException("Configuration was not loaded");
            }
            ApplyCore(config);
        }
        catch (TimeoutException)
        {
            Retry(config);
        }
    }

    private void ApplyCore(ServiceConfig config) { }
    private void Retry(ServiceConfig config) { }
}
`, 'raise-within-try')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// reimplemented-builtin
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/reimplemented-builtin (C#)', () => {
  it('detects a foreach reimplementing Any()', () => {
    const found = matches(`namespace App;
public class FraudScreen
{
    public bool HasLargeOrder(IEnumerable<Order> orders, decimal limit)
    {
        foreach (var order in orders)
        {
            if (order.Total > limit) return true;
        }
        return false;
    }
}
`, 'reimplemented-builtin')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag accumulating or side-effecting loops', () => {
    const found = matches(`namespace App;
public class FraudScreen
{
    public int CountLargeOrders(IEnumerable<Order> orders, decimal limit)
    {
        var count = 0;
        foreach (var order in orders)
        {
            if (order.Total > limit) count++;
        }
        return count;
    }
}
`, 'reimplemented-builtin')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// subclass-builtin-collection
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/subclass-builtin-collection (C#)', () => {
  it('detects a public class inheriting List<T>', () => {
    const found = matches(`namespace App;
public class OrderBatch : List<Order>
{
    public decimal Total()
    {
        return this.Sum(o => o.Total);
    }
}
`, 'subclass-builtin-collection')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag Collection<T> bases or internal types', () => {
    const found = matches(`namespace App;
public class OrderBatch : Collection<Order>
{
    protected override void InsertItem(int index, Order item)
    {
        if (item.Total < 0) throw new ArgumentException("Negative total");
        base.InsertItem(index, item);
    }
}

internal class ScratchOrderList : List<Order>
{
}
`, 'subclass-builtin-collection')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unconditional-assertion
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unconditional-assertion (C#)', () => {
  it('detects Assert.True(true)', () => {
    const found = matches(`using Xunit;
namespace App.Tests;
public class PipelineSmokeTests
{
    [Fact]
    public void Pipeline_runs_without_throwing()
    {
        var pipeline = new Pipeline();
        pipeline.Run();
        Assert.True(true);
    }
}
`, 'unconditional-assertion')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag assertions over runtime values', () => {
    const found = matches(`using Xunit;
namespace App.Tests;
public class PipelineSmokeTests
{
    [Fact]
    public void Pipeline_reports_success()
    {
        var pipeline = new Pipeline();
        var result = pipeline.Run();
        Assert.True(result.IsValid);
        Assert.False(result.HasErrors);
    }
}
`, 'unconditional-assertion')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unnecessary-regular-expression
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unnecessary-regular-expression (C#)', () => {
  it('detects Regex.IsMatch with a metacharacter-free pattern', () => {
    const found = matches(`namespace App;
public class LogScanner
{
    public bool MentionsTimeout(string message)
    {
        return Regex.IsMatch(message, "timeout");
    }
}
`, 'unnecessary-regular-expression')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag real patterns or RegexOptions overloads', () => {
    const found = matches(`namespace App;
public class LogScanner
{
    public bool IsPhoneNumber(string input)
    {
        return Regex.IsMatch(input, @"^\\d{3}-\\d{4}$");
    }

    public bool MentionsTimeout(string message)
    {
        return Regex.IsMatch(message, "timeout", RegexOptions.IgnoreCase);
    }
}
`, 'unnecessary-regular-expression')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// useless-with-lock
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/useless-with-lock (C#)', () => {
  it('detects lock(new object())', () => {
    const found = matches(`namespace App;
public class HitCounter
{
    private int _count;

    public void Increment()
    {
        lock (new object())
        {
            _count++;
        }
    }
}
`, 'useless-with-lock')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag locking a shared sync object', () => {
    const found = matches(`namespace App;
public class HitCounter
{
    private readonly object _sync = new object();
    private int _count;

    public void Increment()
    {
        lock (_sync)
        {
            _count++;
        }
    }
}
`, 'useless-with-lock')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// open-file-without-context-manager
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/open-file-without-context-manager (C#)', () => {
  it('detects a file handle opened without using and never disposed', () => {
    const found = matches(`namespace App;
public class ManifestReader
{
    public string ReadFirstLine(string path)
    {
        var reader = new StreamReader(path);
        var line = reader.ReadLine();
        return line ?? string.Empty;
    }
}
`, 'open-file-without-context-manager')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag using declarations or stream-wrapping overloads', () => {
    const found = matches(`namespace App;
public class ManifestReader
{
    public string ReadFirstLineSafe(string path)
    {
        using var reader = new StreamReader(path);
        return reader.ReadLine() ?? string.Empty;
    }

    public string ReadFrom(Stream manifestStream)
    {
        var reader = new StreamReader(manifestStream);
        return reader.ReadToEnd();
    }
}
`, 'open-file-without-context-manager')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// abstract-class-public-constructor
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/abstract-class-public-constructor (C#)', () => {
  it('flags a public constructor on an abstract class', () => {
    const found = matches(`namespace App;
public abstract class Repository
{
    private readonly string _connectionString;

    public Repository(string connectionString)
    {
        _connectionString = connectionString;
    }
}
`, 'abstract-class-public-constructor')
    expect(found.length).toBe(1)
  })

  it('does not flag a protected constructor or a concrete class', () => {
    const found = matches(`namespace App;
public abstract class Repository
{
    private readonly string _connectionString;

    protected Repository(string connectionString)
    {
        _connectionString = connectionString;
    }
}

public class FileStore
{
    public FileStore() { }
}
`, 'abstract-class-public-constructor')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// abstract-class-without-abstract-members
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/abstract-class-without-abstract-members (C#)', () => {
  it('flags an abstract class with only concrete members', () => {
    const found = matches(`namespace App;
public abstract class BaseHandler
{
    protected readonly string Name = "handler";

    protected void Log(string message)
    {
        System.Console.WriteLine(message);
    }
}
`, 'abstract-class-without-abstract-members')
    expect(found.length).toBe(1)
  })

  it('does not flag an abstract class that declares an abstract member', () => {
    const found = matches(`namespace App;
public abstract class BaseHandler
{
    public abstract void Handle(string payload);

    protected void Log(string message)
    {
        System.Console.WriteLine(message);
    }
}
`, 'abstract-class-without-abstract-members')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// arithmetic-precedence-parentheses
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/arithmetic-precedence-parentheses (C#)', () => {
  it('flags addition mixed with multiplication without parentheses', () => {
    const found = matches(`namespace App;
public class Pricing
{
    public decimal Total(decimal basePrice, decimal taxRate, decimal shipping)
    {
        return basePrice + basePrice * taxRate + shipping;
    }
}
`, 'arithmetic-precedence-parentheses')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag parenthesized or single-tier arithmetic', () => {
    const found = matches(`namespace App;
public class Pricing
{
    public decimal Total(decimal basePrice, decimal taxRate, decimal shipping)
    {
        return basePrice + (basePrice * taxRate) + shipping;
    }

    public decimal Sum(decimal a, decimal b, decimal c)
    {
        return a + b - c;
    }
}
`, 'arithmetic-precedence-parentheses')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// asymmetric-equality-operators
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/asymmetric-equality-operators (C#)', () => {
  it('flags a < operator overloaded without <=', () => {
    const found = matches(`namespace App;
public struct Version
{
    public int Value;

    public static bool operator <(Version a, Version b) => a.Value < b.Value;
    public static bool operator >(Version a, Version b) => a.Value > b.Value;
}
`, 'asymmetric-equality-operators')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag fully paired relational operators', () => {
    const found = matches(`namespace App;
public struct Version
{
    public int Value;

    public static bool operator <(Version a, Version b) => a.Value < b.Value;
    public static bool operator >(Version a, Version b) => a.Value > b.Value;
    public static bool operator <=(Version a, Version b) => a.Value <= b.Value;
    public static bool operator >=(Version a, Version b) => a.Value >= b.Value;
}
`, 'asymmetric-equality-operators')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// attribute-missing-usage
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/attribute-missing-usage (C#)', () => {
  it('flags a custom attribute without [AttributeUsage]', () => {
    const found = matches(`namespace App;
public sealed class AuditedAttribute : Attribute
{
    public string Category { get; }

    public AuditedAttribute(string category)
    {
        Category = category;
    }
}
`, 'attribute-missing-usage')
    expect(found.length).toBe(1)
  })

  it('does not flag an attribute that declares its usage', () => {
    const found = matches(`namespace App;
[AttributeUsage(AttributeTargets.Method)]
public sealed class AuditedAttribute : Attribute
{
    public string Category { get; }

    public AuditedAttribute(string category)
    {
        Category = category;
    }
}
`, 'attribute-missing-usage')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// conditional-precedence-parentheses
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/conditional-precedence-parentheses (C#)', () => {
  it('flags && mixed with || without parentheses', () => {
    const found = matches(`namespace App;
public class AccessPolicy
{
    public bool CanEdit(bool isOwner, bool isAdmin, bool isLocked)
    {
        return isOwner || isAdmin && !isLocked;
    }
}
`, 'conditional-precedence-parentheses')
    expect(found.length).toBe(1)
  })

  it('does not flag parenthesized or single-operator conditions', () => {
    const found = matches(`namespace App;
public class AccessPolicy
{
    public bool CanEdit(bool isOwner, bool isAdmin, bool isLocked)
    {
        return isOwner || (isAdmin && !isLocked);
    }

    public bool CanView(bool a, bool b, bool c)
    {
        return a && b && c;
    }
}
`, 'conditional-precedence-parentheses')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// cref-with-prefix
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/cref-with-prefix (C#)', () => {
  it('flags a doc cref carrying a member-kind prefix', () => {
    const found = matches(`namespace App;
public class OrderService
{
    /// <summary>Delegates to <see cref="M:App.OrderService.Submit"/>.</summary>
    public void SubmitAll() { }
}
`, 'cref-with-prefix')
    expect(found.length).toBe(1)
  })

  it('does not flag a plain cref', () => {
    const found = matches(`namespace App;
public class OrderService
{
    /// <summary>Delegates to <see cref="Submit"/>.</summary>
    public void SubmitAll() { }

    public void Submit() { }
}
`, 'cref-with-prefix')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// debug-assert-false
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/debug-assert-false (C#)', () => {
  it('flags Debug.Assert(false)', () => {
    const found = matches(`namespace App;
using System.Diagnostics;
public class StateMachine
{
    public void Transition(string state)
    {
        switch (state)
        {
            case "open": return;
            case "closed": return;
            default:
                Debug.Assert(false, "unknown state");
                return;
        }
    }
}
`, 'debug-assert-false')
    expect(found.length).toBe(1)
  })

  it('does not flag a normal Debug.Assert or Debug.Fail', () => {
    const found = matches(`namespace App;
using System.Diagnostics;
public class StateMachine
{
    public void Check(int count)
    {
        Debug.Assert(count > 0);
        Debug.Fail("unreachable");
    }
}
`, 'debug-assert-false')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// duplicate-switch-section-bodies
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/duplicate-switch-section-bodies (C#)', () => {
  it('flags two switch sections with identical bodies', () => {
    const found = matches(`namespace App;
public class Router
{
    public string Resolve(string scheme)
    {
        switch (scheme)
        {
            case "http":
                return BuildUrl("insecure", 80);
            case "https":
                return BuildUrl("insecure", 80);
            default:
                return BuildUrl("local", 0);
        }
    }

    private string BuildUrl(string mode, int port) => mode + port;
}
`, 'duplicate-switch-section-bodies')
    expect(found.length).toBe(1)
  })

  it('does not flag sections with distinct bodies', () => {
    const found = matches(`namespace App;
public class Router
{
    public string Resolve(string scheme)
    {
        switch (scheme)
        {
            case "http":
                return BuildUrl("insecure", 80);
            case "https":
                return BuildUrl("secure", 443);
            default:
                return BuildUrl("local", 0);
        }
    }

    private string BuildUrl(string mode, int port) => mode + port;
}
`, 'duplicate-switch-section-bodies')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// duplicate-word-in-comment
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/duplicate-word-in-comment (C#)', () => {
  it('flags a repeated word in a comment', () => {
    const found = matches(`namespace App;
public class Cache
{
    // Evict the the oldest entry when capacity is exceeded.
    public void Trim() { }
}
`, 'duplicate-word-in-comment')
    expect(found.length).toBe(1)
  })

  it('does not flag normal comments', () => {
    const found = matches(`namespace App;
public class Cache
{
    // Evict the oldest entry when capacity is exceeded.
    public void Trim() { }
}
`, 'duplicate-word-in-comment')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// empty-comment
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/empty-comment (C#)', () => {
  it('flags a comment marker with no text', () => {
    const found = matches(`namespace App;
public class Worker
{
    public void Run()
    {
        //
        Process();
    }

    private void Process() { }
}
`, 'empty-comment')
    expect(found.length).toBe(1)
  })

  it('does not flag comments with text or divider lines', () => {
    const found = matches(`namespace App;
public class Worker
{
    // ----------------------------------
    // Runs the work loop.
    public void Run() { }
}
`, 'empty-comment')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// empty-else-clause
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/empty-else-clause (C#)', () => {
  it('flags an empty else branch', () => {
    const found = matches(`namespace App;
public class Validator
{
    public void Check(bool ok, System.Collections.Generic.List<string> errors)
    {
        if (ok)
        {
            errors.Clear();
        }
        else
        {
        }
    }
}
`, 'empty-else-clause')
    expect(found.length).toBe(1)
  })

  it('does not flag a non-empty else or an else-if chain', () => {
    const found = matches(`namespace App;
public class Validator
{
    public string Check(int code)
    {
        if (code == 200)
        {
            return "ok";
        }
        else if (code >= 500)
        {
            return "server";
        }
        else
        {
            return "other";
        }
    }
}
`, 'empty-else-clause')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// empty-interface
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/empty-interface (C#)', () => {
  it('flags a marker interface with no members', () => {
    const found = matches(`namespace App;
public interface IAggregateRoot
{
}
`, 'empty-interface')
    expect(found.length).toBe(1)
  })

  it('does not flag interfaces with members or composed interfaces', () => {
    const found = matches(`namespace App;
public interface IEntity
{
    int Id { get; }
}

public interface IAuditable : IEntity
{
}
`, 'empty-interface')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// empty-namespace-declaration
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/empty-namespace-declaration (C#)', () => {
  it('flags a block namespace declaring no types', () => {
    const found = matches(`namespace App.Legacy
{
}
`, 'empty-namespace-declaration')
    expect(found.length).toBe(1)
  })

  it('does not flag a namespace that declares a type', () => {
    const found = matches(`namespace App.Domain
{
    public class Order { }
}
`, 'empty-namespace-declaration')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// enum-member-prefixed-with-type
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/enum-member-prefixed-with-type (C#)', () => {
  it('flags an enum member prefixed with the enum name', () => {
    const found = matches(`namespace App;
public enum LogLevel
{
    LogLevelTrace,
    Information,
    Warning
}
`, 'enum-member-prefixed-with-type')
    expect(found.length).toBe(1)
  })

  it('does not flag members that merely start with the type name as one word', () => {
    const found = matches(`namespace App;
public enum Color
{
    Red,
    Green,
    Colorful
}
`, 'enum-member-prefixed-with-type')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// enum-reserved-member-name
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/enum-reserved-member-name (C#)', () => {
  it('flags an enum member named Reserved', () => {
    const found = matches(`namespace App;
public enum Slot
{
    Active,
    Inactive,
    Reserved
}
`, 'enum-reserved-member-name')
    expect(found.length).toBe(1)
  })

  it('does not flag meaningfully named members', () => {
    const found = matches(`namespace App;
public enum Slot
{
    Active,
    Inactive,
    Pending
}
`, 'enum-reserved-member-name')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// exception-named-type-not-exception
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/exception-named-type-not-exception (C#)', () => {
  it('flags an Exception-named type that does not derive from Exception', () => {
    const found = matches(`namespace App;
public class ValidationException
{
    public string Field { get; }

    public ValidationException(string field)
    {
        Field = field;
    }
}
`, 'exception-named-type-not-exception')
    expect(found.length).toBe(1)
  })

  it('does not flag a real exception type', () => {
    const found = matches(`namespace App;
public class ValidationException : Exception
{
    public string Field { get; }

    public ValidationException(string field) : base(field)
    {
        Field = field;
    }
}
`, 'exception-named-type-not-exception')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// exception-type-not-public
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/exception-type-not-public (C#)', () => {
  it('flags an internal exception type', () => {
    const found = matches(`namespace App;
internal class TenantNotFoundException : Exception
{
    public TenantNotFoundException(string message) : base(message) { }
}
`, 'exception-type-not-public')
    expect(found.length).toBe(1)
  })

  it('does not flag a public exception type', () => {
    const found = matches(`namespace App;
public class TenantNotFoundException : Exception
{
    public TenantNotFoundException(string message) : base(message) { }
}
`, 'exception-type-not-public')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unnecessary-unary-plus
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unnecessary-unary-plus (C#)', () => {
  it('flags a unary plus', () => {
    const found = matches(`namespace App;
public class C
{
    public int Adjust(int x) => +x;
}
`, 'unnecessary-unary-plus')
    expect(found.length).toBe(1)
  })

  it('does not flag a unary minus or binary plus', () => {
    const found = matches(`namespace App;
public class C
{
    public int A(int x) => -x;
    public int B(int x, int y) => x + y;
}
`, 'unnecessary-unary-plus')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// nullable-shorthand
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/nullable-shorthand (C#)', () => {
  it('flags Nullable<T> long form', () => {
    const found = matches(`namespace App;
public class C
{
    public Nullable<int> Count { get; set; }
}
`, 'nullable-shorthand')
    expect(found.length).toBe(1)
  })

  it('does not flag the T? shorthand or other generics', () => {
    const found = matches(`namespace App;
public class C
{
    public int? Count { get; set; }
    public List<int> Items { get; set; }
}
`, 'nullable-shorthand')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unnecessary-verbatim-string
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unnecessary-verbatim-string (C#)', () => {
  it('flags a verbatim string with no escapes', () => {
    const found = matches(`namespace App;
public class C
{
    public string Label() => @"plain text";
}
`, 'unnecessary-verbatim-string')
    expect(found.length).toBe(1)
  })

  it('does not flag a verbatim string with a backslash', () => {
    const found = matches(`namespace App;
public class C
{
    public string Path() => @"C:\\temp\\data";
}
`, 'unnecessary-verbatim-string')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// redundant-base-constructor-call
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/redundant-base-constructor-call (C#)', () => {
  it('flags an empty : base() initializer', () => {
    const found = matches(`namespace App;
public class Derived : Widget
{
    public Derived() : base()
    {
    }
}
`, 'redundant-base-constructor-call')
    expect(found.length).toBe(1)
  })

  it('does not flag base(args) or this()', () => {
    const found = matches(`namespace App;
public class Derived : Widget
{
    public Derived(int id) : base(id)
    {
    }

    public Derived() : this(0)
    {
    }
}
`, 'redundant-base-constructor-call')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// redundant-base-type
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/redundant-base-type (C#)', () => {
  it('flags object in a base list', () => {
    const found = matches(`namespace App;
public class Widget : object
{
}
`, 'redundant-base-type')
    expect(found.length).toBe(1)
  })

  it('does not flag a real base type or interface', () => {
    const found = matches(`namespace App;
public class Widget : Control, IDisposable
{
    public void Dispose() { }
}
`, 'redundant-base-type')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// obsolete-without-message
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/obsolete-without-message (C#)', () => {
  it('flags [Obsolete] with no message', () => {
    const found = matches(`namespace App;
public class C
{
    [Obsolete]
    public void Old() { }
}
`, 'obsolete-without-message')
    expect(found.length).toBe(1)
  })

  it('does not flag [Obsolete] with a message', () => {
    const found = matches(`namespace App;
public class C
{
    [Obsolete("Use New instead.")]
    public void Old() { }
}
`, 'obsolete-without-message')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// not-implemented-exception
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/not-implemented-exception (C#)', () => {
  it('flags throw new NotImplementedException()', () => {
    const found = matches(`namespace App;
public class C
{
    public void Pending()
    {
        throw new NotImplementedException();
    }
}
`, 'not-implemented-exception')
    expect(found.length).toBe(1)
  })

  it('does not flag other thrown exceptions', () => {
    const found = matches(`namespace App;
public class C
{
    public void Guard(string s)
    {
        throw new ArgumentNullException(nameof(s));
    }
}
`, 'not-implemented-exception')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unnecessary-record-braces
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unnecessary-record-braces (C#)', () => {
  it('flags a positional record with an empty body', () => {
    const found = matches(`namespace App;
public record Point(int X, int Y) { }
`, 'unnecessary-record-braces')
    expect(found.length).toBe(1)
  })

  it('does not flag a semicolon-terminated record or one with members', () => {
    const found = matches(`namespace App;
public record Point(int X, int Y);
public record Vec(int X, int Y)
{
    public int Length => X + Y;
}
`, 'unnecessary-record-braces')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// enum-underlying-type-not-int32
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/enum-underlying-type-not-int32 (C#)', () => {
  it('flags a non-Int32 underlying type', () => {
    const found = matches(`namespace App;
public enum Mode : long
{
    Off,
    On
}
`, 'enum-underlying-type-not-int32')
    expect(found.length).toBe(1)
  })

  it('does not flag the default or explicit Int32 storage', () => {
    const found = matches(`namespace App;
public enum Mode
{
    Off,
    On
}
public enum Other : int
{
    A
}
`, 'enum-underlying-type-not-int32')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// redundant-default-switch-section
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/redundant-default-switch-section (C#)', () => {
  it('flags a default section that only breaks', () => {
    const found = matches(`namespace App;
public class C
{
    public void M(int x)
    {
        switch (x)
        {
            case 1:
                Handle();
                break;
            default:
                break;
        }
    }
}
`, 'redundant-default-switch-section')
    expect(found.length).toBe(1)
  })

  it('does not flag a default section that does work', () => {
    const found = matches(`namespace App;
public class C
{
    public void M(int x)
    {
        switch (x)
        {
            case 1:
                Handle();
                break;
            default:
                HandleOther();
                break;
        }
    }
}
`, 'redundant-default-switch-section')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// use-null-coalescing-assignment
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/use-null-coalescing-assignment (C#)', () => {
  it('flags if (x == null) x = y;', () => {
    const found = matches(`namespace App;
public class C
{
    public void M(string s)
    {
        if (s == null) s = "default";
    }
}
`, 'use-null-coalescing-assignment')
    expect(found.length).toBe(1)
  })

  it('does not flag a null check with an else or different target', () => {
    const found = matches(`namespace App;
public class C
{
    public void M(string s, string t)
    {
        if (s == null) t = "default";
        if (s == null) { Log(s); } else { Use(s); }
    }
}
`, 'use-null-coalescing-assignment')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// use-null-coalescing
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/use-null-coalescing (C#)', () => {
  it('flags a != null ? a : b', () => {
    const found = matches(`namespace App;
public class C
{
    public string Pick(string a, string b) => a != null ? a : b;
}
`, 'use-null-coalescing')
    expect(found.length).toBe(1)
  })

  it('does not flag an unrelated ternary', () => {
    const found = matches(`namespace App;
public class C
{
    public string Pick(string a, string b) => a != null ? b : a;
    public int Sign(int x) => x > 0 ? 1 : -1;
}
`, 'use-null-coalescing')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// prefer-tuple-syntax
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/prefer-tuple-syntax (C#)', () => {
  it('flags ValueTuple<...> usage', () => {
    const found = matches(`namespace App;
public class C
{
    public ValueTuple<int, string> Pair() => default;
}
`, 'prefer-tuple-syntax')
    expect(found.length).toBe(1)
  })

  it('does not flag tuple syntax or single-element ValueTuple', () => {
    const found = matches(`namespace App;
public class C
{
    public (int, string) Pair() => default;
    public ValueTuple<int> One() => default;
}
`, 'prefer-tuple-syntax')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unsealed-attribute
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unsealed-attribute (C#)', () => {
  it('flags an unsealed attribute class', () => {
    const found = matches(`namespace App;
public class RouteTag : Attribute
{
}
`, 'unsealed-attribute')
    expect(found.length).toBe(1)
  })

  it('does not flag a sealed or abstract attribute', () => {
    const found = matches(`namespace App;
public sealed class RouteTag : Attribute
{
}
public abstract class BaseTag : Attribute
{
}
`, 'unsealed-attribute')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// prefer-lambda-over-delegate
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/prefer-lambda-over-delegate (C#)', () => {
  it('flags a delegate anonymous method', () => {
    const found = matches(`namespace App;
public class C
{
    public void Wire()
    {
        Action<int> handler = delegate(int x) { Use(x); };
    }
}
`, 'prefer-lambda-over-delegate')
    expect(found.length).toBe(1)
  })

  it('does not flag a lambda', () => {
    const found = matches(`namespace App;
public class C
{
    public void Wire()
    {
        Action<int> handler = (int x) => Use(x);
    }
}
`, 'prefer-lambda-over-delegate')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// static-holder-type-has-constructor
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/static-holder-type-has-constructor (C#)', () => {
  it('flags a static-holder type with a public instance constructor', () => {
    const found = matches(`namespace App;
public class Constants
{
    public static readonly int Max = 100;
    public static void Reset() { }

    public Constants() { }
}
`, 'static-holder-type-has-constructor')
    expect(found.length).toBe(1)
  })

  it('does not flag a type with instance members', () => {
    const found = matches(`namespace App;
public class Service
{
    public int Count;
    public Service() { }
    public void Run() { }
}
`, 'static-holder-type-has-constructor')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// use-string-concat-over-join
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/use-string-concat-over-join (C#)', () => {
  it('flags string.Join with an empty separator', () => {
    const found = matches(`namespace App;
public class C
{
    public string Combine(string[] parts) => string.Join("", parts);
}
`, 'use-string-concat-over-join')
    expect(found.length).toBe(1)
  })

  it('does not flag Join with a real separator', () => {
    const found = matches(`namespace App;
public class C
{
    public string Combine(string[] parts) => string.Join(", ", parts);
}
`, 'use-string-concat-over-join')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// use-eventargs-empty
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/use-eventargs-empty (C#)', () => {
  it('flags new EventArgs()', () => {
    const found = matches(`namespace App;
public class C
{
    public event EventHandler Done;
    public void Raise() => Done?.Invoke(this, new EventArgs());
}
`, 'use-eventargs-empty')
    expect(found.length).toBe(1)
  })

  it('does not flag EventArgs.Empty or a derived args type', () => {
    const found = matches(`namespace App;
public class C
{
    public event EventHandler Done;
    public void Raise() => Done?.Invoke(this, EventArgs.Empty);
    public object Make() => new OrderEventArgs(42);
}
`, 'use-eventargs-empty')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// prefer-string-empty
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/prefer-string-empty (C#)', () => {
  it('flags an empty string literal in an assignment/return position', () => {
    const found = matches(`namespace App;
public class C
{
    public string Blank()
    {
        var note = "";
        return note;
    }
}
`, 'prefer-string-empty')
    expect(found.length).toBe(1)
  })

  it('does not flag non-empty literals, comparisons, or call arguments', () => {
    const found = matches(`namespace App;
public class C
{
    public bool Empty(string s) => s == "";
    public string[] Split(string s) => s.Split("");
    public string Name() => "value";
}
`, 'prefer-string-empty')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// infinite-loop-non-canonical
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/infinite-loop-non-canonical (C#)', () => {
  it('flags for(;;) and do/while(true)', () => {
    const a = matches(`namespace App;
public class C { public void A() { for (;;) { Work(); } } public void Work() {} }
`, 'infinite-loop-non-canonical')
    const b = matches(`namespace App;
public class C { public void B() { do { Work(); } while (true); } public void Work() {} }
`, 'infinite-loop-non-canonical')
    expect(a.length).toBe(1)
    expect(b.length).toBe(1)
  })

  it('does not flag while(true) or a bounded for/do', () => {
    const found = matches(`namespace App;
public class C
{
    public void A() { while (true) { Work(); } }
    public void B() { for (int i = 0; i < 10; i++) { Work(); } }
    public void D() { int n = 0; do { Work(); n++; } while (n < 3); }
    public void Work() {}
}
`, 'infinite-loop-non-canonical')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// manual-enumerator-loop
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/manual-enumerator-loop (C#)', () => {
  it('flags a hand-rolled GetEnumerator/MoveNext loop', () => {
    const found = matches(`namespace App;
using System.Collections.Generic;
public class C
{
    public int Sum(List<int> items)
    {
        var sum = 0;
        var e = items.GetEnumerator();
        while (e.MoveNext())
        {
            sum += e.Current;
        }
        return sum;
    }
}
`, 'manual-enumerator-loop')
    expect(found.length).toBe(1)
  })

  it('does not flag a foreach or a while over a different condition', () => {
    const found = matches(`namespace App;
using System.Collections.Generic;
public class C
{
    public int Sum(List<int> items)
    {
        var sum = 0;
        foreach (var x in items) sum += x;
        var i = 0;
        while (i < items.Count) { sum += items[i]; i++; }
        return sum;
    }
}
`, 'manual-enumerator-loop')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// redundant-tostring-call
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/redundant-tostring-call (C#)', () => {
  it('flags ToString() in concatenation and interpolation', () => {
    const a = matches(`namespace App;
public class C { public string M(int x) => "id-" + x.ToString(); }
`, 'redundant-tostring-call')
    const b = matches(`namespace App;
public class C { public string M(int x) => $"{x.ToString()}"; }
`, 'redundant-tostring-call')
    expect(a.length).toBe(1)
    expect(b.length).toBe(1)
  })

  it('does not flag a formatted ToString or a standalone ToString', () => {
    const found = matches(`namespace App;
public class C
{
    public string M(int x) => "hex-" + x.ToString("X");
    public string N(int x) => x.ToString();
    public int Sum(int a, int b) => a + b;
}
`, 'redundant-tostring-call')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// redundant-tochararray-call
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/redundant-tochararray-call (C#)', () => {
  it('flags ToCharArray() as a foreach source', () => {
    const found = matches(`namespace App;
public class C
{
    public int Count(string s)
    {
        var n = 0;
        foreach (var c in s.ToCharArray()) { if (c == 'a') n++; }
        return n;
    }
}
`, 'redundant-tochararray-call')
    expect(found.length).toBe(1)
  })

  it('does not flag iterating the string directly or a sliced ToCharArray', () => {
    const found = matches(`namespace App;
public class C
{
    public int Count(string s)
    {
        var n = 0;
        foreach (var c in s) { if (c == 'a') n++; }
        foreach (var c in s.ToCharArray(0, 2)) { if (c == 'b') n++; }
        return n;
    }
}
`, 'redundant-tochararray-call')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// static-readonly-should-be-const
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/static-readonly-should-be-const (C#)', () => {
  it('flags a static readonly primitive initialized to a literal', () => {
    const found = matches(`namespace App;
public class C { private static readonly int MaxRetries = 5; }
`, 'static-readonly-should-be-const')
    expect(found.length).toBe(1)
  })

  it('does not flag non-literal, non-primitive, or instance readonly', () => {
    const found = matches(`namespace App;
public class C
{
    private static readonly int Computed = Compute();
    private static readonly int[] Codes = { 1, 2, 3 };
    private readonly int _id = 7;
    private static int Compute() => 3;
}
`, 'static-readonly-should-be-const')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// redundant-length-argument
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/redundant-length-argument (C#)', () => {
  it('flags Substring(start, s.Length - start)', () => {
    const found = matches(`namespace App;
public class C { public string Tail(string s) => s.Substring(2, s.Length - 2); }
`, 'redundant-length-argument')
    expect(found.length).toBe(1)
  })

  it('does not flag a real length or a mismatched start', () => {
    const found = matches(`namespace App;
public class C
{
    public string A(string s) => s.Substring(2, 4);
    public string B(string s) => s.Substring(2, s.Length - 3);
    public string D(string s) => s.Substring(2);
}
`, 'redundant-length-argument')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// trace-write-usage
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/trace-write-usage (C#)', () => {
  it('flags Trace.Write and Trace.WriteLine', () => {
    const found = matches(`namespace App;
using System.Diagnostics;
public class C
{
    public void A(string m) { Trace.WriteLine(m); }
    public void B(string m) { Trace.Write(m); }
}
`, 'trace-write-usage')
    expect(found.length).toBe(2)
  })

  it('does not flag a logger or Trace.TraceError', () => {
    const found = matches(`namespace App;
using System.Diagnostics;
public class C
{
    private readonly ILogger _log;
    public void A(string m) { _log.LogInformation(m); }
    public void B(string m) { Trace.TraceError(m); }
}
`, 'trace-write-usage')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// non-private-field
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/non-private-field (C#)', () => {
  it('flags public and protected mutable class fields', () => {
    const found = matches(`namespace App;
public class C
{
    public int Count;
    protected string Name;
}
`, 'non-private-field')
    expect(found.length).toBe(2)
  })

  it('does not flag private fields, const, or static readonly', () => {
    const found = matches(`namespace App;
public class C
{
    private int _count;
    public const int Max = 10;
    public static readonly string Prefix = Compute();
    private static string Compute() => "x";
}
`, 'non-private-field')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// enum-missing-zero-value
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/enum-missing-zero-value (C#)', () => {
  it('flags a non-flags enum with all explicit non-zero values', () => {
    const found = matches(`namespace App;
public enum Mode { Primary = 1, Secondary = 2 }
`, 'enum-missing-zero-value')
    expect(found.length).toBe(1)
  })

  it('does not flag an enum with a zero member, implicit values, or [Flags]', () => {
    const found = matches(`namespace App;
using System;
public enum A { None = 0, Primary = 1 }
public enum B { First, Second }
[Flags]
public enum C { Read = 1, Write = 2 }
`, 'enum-missing-zero-value')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// redundant-anonymous-property-name
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/redundant-anonymous-property-name (C#)', () => {
  it('flags an explicit name matching the source member', () => {
    const found = matches(`namespace App;
public class C { public object M(Account a) => new { a.Id, Name = a.Name }; }
public class Account { public int Id { get; } public string Name { get; } }
`, 'redundant-anonymous-property-name')
    expect(found.length).toBe(1)
  })

  it('does not flag a renamed member or already-inferred names', () => {
    const found = matches(`namespace App;
public class C { public object M(Account a) => new { a.Id, Label = a.Name }; }
public class Account { public int Id { get; } public string Name { get; } }
`, 'redundant-anonymous-property-name')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unnecessary-declaration-semicolon
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unnecessary-declaration-semicolon (C#)', () => {
  it('flags a trailing semicolon after a type body', () => {
    const found = matches(`namespace App;
public class C { public int V => 1; };
`, 'unnecessary-declaration-semicolon')
    expect(found.length).toBe(1)
  })

  it('does not flag a normal type declaration', () => {
    const found = matches(`namespace App;
public class C { public int V => 1; }
public enum E { A = 0, B = 1 }
`, 'unnecessary-declaration-semicolon')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// redundant-default-initializer
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/redundant-default-initializer (C#)', () => {
  it('flags fields initialized to their type default', () => {
    const found = matches(`namespace App;
public class C
{
    private int _count = 0;
    private string _name = null;
    private bool _ready = false;
}
`, 'redundant-default-initializer')
    expect(found.length).toBe(3)
  })

  it('does not flag non-default initializers or const', () => {
    const found = matches(`namespace App;
public class C
{
    private int _count = 1;
    private string _name = "x";
    private bool _ready = true;
    private const int Max = 0;
}
`, 'redundant-default-initializer')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// string-compare-to-zero
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/string-compare-to-zero (C#)', () => {
  it('flags String.Compare(...) == 0', () => {
    const found = matches(`namespace App;
public class C { public bool Same(string a, string b) => string.Compare(a, b) == 0; }
`, 'string-compare-to-zero')
    expect(found.length).toBe(1)
  })

  it('does not flag ordering comparisons or non-Compare equality', () => {
    const found = matches(`namespace App;
public class C
{
    public bool Less(string a, string b) => string.Compare(a, b) < 0;
    public bool Eq(int a) => a == 0;
}
`, 'string-compare-to-zero')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// redundant-override
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/redundant-override (C#)', () => {
  it('flags an override that only forwards to base with the same args', () => {
    const found = matches(`namespace App;
public class Derived : Base
{
    public override string Render(string input) => base.Render(input);
}
public class Base { public virtual string Render(string input) => input; }
`, 'redundant-override')
    expect(found.length).toBe(1)
  })

  it('does not flag an override that adds logic or reorders arguments', () => {
    const found = matches(`namespace App;
public class Derived : Base
{
    public override string Render(string input) => base.Render(input.Trim());
    public override string Combine(string a, string b) => base.Combine(b, a);
}
public class Base
{
    public virtual string Render(string input) => input;
    public virtual string Combine(string a, string b) => a + b;
}
`, 'redundant-override')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// literal-suffix-over-cast
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/literal-suffix-over-cast (C#)', () => {
  it('flags a cast of a numeric literal to a suffixable type', () => {
    const found = matches(`namespace App;
public class C
{
    public long A() => (long)1;
    public decimal B() => (decimal)0.5;
}
`, 'literal-suffix-over-cast')
    expect(found.length).toBe(2)
  })

  it('does not flag casts of non-literals or to non-suffixable types', () => {
    const found = matches(`namespace App;
public class C
{
    public long A(int x) => (long)x;
    public int B() => (int)1.5;
    public short S() => (short)1;
}
`, 'literal-suffix-over-cast')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// too-many-type-parameters
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/too-many-type-parameters (C#)', () => {
  it('flags a type with three or more type parameters', () => {
    const found = matches(`namespace App;
public class Triple<T1, T2, T3> { }
`, 'too-many-type-parameters')
    expect(found.length).toBe(1)
  })

  it('does not flag a type with one or two parameters', () => {
    const found = matches(`namespace App;
public class Pair<TKey, TValue> { }
public class Box<T> { }
`, 'too-many-type-parameters')
    expect(found).toHaveLength(0)
  })
})
