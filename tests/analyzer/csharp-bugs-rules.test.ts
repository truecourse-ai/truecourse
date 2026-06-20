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

describe('bugs/deterministic/empty-catch (C#)', () => {
  const key = 'bugs/deterministic/empty-catch'

  it('detects a catch block that swallows exceptions silently', () => {
    const found = matches(`namespace Billing;
public class InvoiceSync
{
    public void Sync(Invoice invoice)
    {
        try
        {
            _gateway.Push(invoice);
            _repository.MarkSynced(invoice.Id);
        }
        catch (Exception ex)
        {
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag cancellation ignores, best-effort cleanup, or handled catches', () => {
    const found = matches(`namespace Billing;
public class InvoiceSync
{
    public async Task RunAsync(CancellationToken token)
    {
        try
        {
            await _worker.LoopAsync(token);
        }
        catch (OperationCanceledException)
        {
        }
    }

    public void Shutdown()
    {
        try { _watcher.Dispose(); } catch { }
    }

    public void Sync(Invoice invoice)
    {
        try
        {
            _gateway.Push(invoice);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to push invoice {Id}", invoice.Id);
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/self-comparison (C#)', () => {
  const key = 'bugs/deterministic/self-comparison'

  it('detects comparing a value to itself', () => {
    const found = matches(`namespace Billing;
public class PriceValidator
{
    public bool Validate(Order order)
    {
        if (order.Total == order.Total)
        {
            return true;
        }
        return false;
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag comparisons between different expressions', () => {
    const found = matches(`namespace Billing;
public class PriceValidator
{
    public bool Validate(Order order, Order other)
    {
        return order.Total == other.Total && order.Items.Count >= other.Items.Count;
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/self-assignment (C#)', () => {
  const key = 'bugs/deterministic/self-assignment'

  it('detects the classic missing-this constructor typo', () => {
    const found = matches(`namespace Billing;
public class Customer
{
    private string name;

    public Customer(string name)
    {
        name = name;
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag assigning a parameter to a field', () => {
    const found = matches(`namespace Billing;
public class Customer
{
    private string name;

    public Customer(string name)
    {
        this.name = name;
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/assignment-in-condition (C#)', () => {
  const key = 'bugs/deterministic/assignment-in-condition'

  it('detects = where == was intended in an if condition', () => {
    const found = matches(`namespace Billing;
public class OrderProcessor
{
    private bool isValid;

    public void Process(Order order)
    {
        if (isValid = Validate(order))
        {
            Save(order);
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag the read-and-test loop idiom', () => {
    const found = matches(`namespace Billing;
public class ImportReader
{
    public void ReadAll(StreamReader reader)
    {
        string line;
        while ((line = reader.ReadLine()) != null)
        {
            Process(line);
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/all-branches-identical (C#)', () => {
  const key = 'bugs/deterministic/all-branches-identical'

  it('detects if/else with identical bodies', () => {
    const found = matches(`namespace Billing;
public class ShippingCalculator
{
    public decimal Calculate(Order order)
    {
        if (order.IsExpress)
        {
            return order.Weight * 2.5m;
        }
        else
        {
            return order.Weight * 2.5m;
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag branches that differ', () => {
    const found = matches(`namespace Billing;
public class ShippingCalculator
{
    public decimal Calculate(Order order)
    {
        if (order.IsExpress)
        {
            return order.Weight * 2.5m;
        }
        else
        {
            return order.Weight * 1.2m;
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/duplicate-else-if (C#)', () => {
  const key = 'bugs/deterministic/duplicate-else-if'

  it('detects a repeated condition in an else-if chain', () => {
    const found = matches(`namespace Billing;
public class TierResolver
{
    public string Resolve(Customer customer)
    {
        if (customer.TotalSpend > 10000) return "platinum";
        else if (customer.TotalSpend > 5000) return "gold";
        else if (customer.TotalSpend > 10000) return "silver";
        return "standard";
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag distinct conditions', () => {
    const found = matches(`namespace Billing;
public class TierResolver
{
    public string Resolve(Customer customer)
    {
        if (customer.TotalSpend > 10000) return "platinum";
        else if (customer.TotalSpend > 5000) return "gold";
        else if (customer.TotalSpend > 1000) return "silver";
        return "standard";
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/duplicate-branches (C#)', () => {
  const key = 'bugs/deterministic/duplicate-branches'

  it('detects copy-pasted multi-statement branch bodies', () => {
    const found = matches(`namespace Billing;
public class RefundHandler
{
    public void Handle(Refund refund)
    {
        if (refund.Amount > 1000)
        {
            _approvals.RequireManager(refund);
            _audit.Record(refund.Id, "manager-review");
        }
        else if (refund.Reason == RefundReason.Fraud)
        {
            _approvals.RequireManager(refund);
            _audit.Record(refund.Id, "manager-review");
        }
    }
}
`, key)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag short identical guard bodies', () => {
    const found = matches(`namespace Billing;
public class RefundHandler
{
    public bool CanRefund(Refund refund)
    {
        if (refund.Amount <= 0)
        {
            return false;
        }
        else if (refund.Order == null)
        {
            return false;
        }
        return true;
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/constant-condition (C#)', () => {
  const key = 'bugs/deterministic/constant-condition'

  it('detects an always-false branch left behind', () => {
    const found = matches(`namespace Billing;
public class FeatureGate
{
    public void Apply(Order order)
    {
        if (false)
        {
            _legacyPricing.Apply(order);
        }
        _pricing.Apply(order);
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag the idiomatic while(true) worker loop', () => {
    const found = matches(`namespace Billing;
public class QueueWorker
{
    public async Task RunAsync(CancellationToken token)
    {
        while (true)
        {
            var job = await _queue.DequeueAsync(token);
            if (job == null) continue;
            await ProcessAsync(job);
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/unreachable-code (C#)', () => {
  const key = 'bugs/deterministic/unreachable-code'

  it('detects statements after an unconditional return', () => {
    const found = matches(`namespace Billing;
public class DiscountService
{
    public decimal Apply(Order order)
    {
        return order.Total * 0.9m;
        _audit.Record(order.Id, "discount-applied");
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag local functions declared after the return', () => {
    const found = matches(`namespace Billing;
public class DiscountService
{
    public decimal Apply(Order order)
    {
        return Calculate(order.Total);

        decimal Calculate(decimal total)
        {
            return total * 0.9m;
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/unreachable-loop (C#)', () => {
  const key = 'bugs/deterministic/unreachable-loop'

  it('detects a loop whose body always exits on the first iteration', () => {
    const found = matches(`namespace Billing;
public class RetryPolicy
{
    public Response Execute(Request request)
    {
        while (request.AttemptsRemaining > 0)
        {
            var response = _client.Send(request);
            return response;
        }
        throw new TimeoutException("no attempts remaining");
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag a loop with a conditional exit', () => {
    const found = matches(`namespace Billing;
public class RetryPolicy
{
    public Response Execute(Request request)
    {
        while (request.AttemptsRemaining > 0)
        {
            var response = _client.Send(request);
            if (response.IsSuccess)
            {
                return response;
            }
            request.AttemptsRemaining--;
        }
        throw new TimeoutException("no attempts remaining");
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/for-direction (C#)', () => {
  const key = 'bugs/deterministic/for-direction'

  it('detects a counter moving away from its bound', () => {
    const found = matches(`namespace Billing;
public class LineItemPrinter
{
    public void Print(Order order)
    {
        for (int i = 0; i < order.Items.Count; i--)
        {
            Console.WriteLine(order.Items[i].Name);
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag a correct reverse loop', () => {
    const found = matches(`namespace Billing;
public class LineItemPrinter
{
    public void Print(Order order)
    {
        for (int i = order.Items.Count - 1; i >= 0; i--)
        {
            Console.WriteLine(order.Items[i].Name);
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/unmodified-loop-condition (C#)', () => {
  const key = 'bugs/deterministic/unmodified-loop-condition'

  it('detects a while loop that never updates its condition variables', () => {
    const found = matches(`namespace Billing;
public class InterestProjector
{
    public decimal Project(decimal principal, int years, int maxYears)
    {
        decimal total = principal;
        while (years < maxYears)
        {
            total += total * 0.05m;
        }
        return total;
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag loops that step the condition variable or call methods', () => {
    const found = matches(`namespace Billing;
public class InterestProjector
{
    public decimal Project(decimal principal, int years, int maxYears)
    {
        decimal total = principal;
        while (years < maxYears)
        {
            total += total * 0.05m;
            years++;
        }
        return total;
    }

    public void Drain(JobQueue queue)
    {
        while (queue.Count > 0)
        {
            queue.Dequeue();
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/loop-counter-assignment (C#)', () => {
  const key = 'bugs/deterministic/loop-counter-assignment'

  it('detects resetting the loop counter inside the body', () => {
    const found = matches(`namespace Billing;
public class BatchScanner
{
    public void Scan(List<Record> records)
    {
        for (int i = 0; i < records.Count; i++)
        {
            if (records[i].IsCorrupt)
            {
                i = 0;
            }
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag compound stepping of the counter', () => {
    const found = matches(`namespace Billing;
public class BatchScanner
{
    public void Scan(List<Record> records, int batchSize)
    {
        for (int i = 0; i < records.Count; i++)
        {
            if (records[i].IsHeader)
            {
                i += batchSize;
            }
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/float-equality-comparison (C#)', () => {
  const key = 'bugs/deterministic/float-equality-comparison'

  it('detects == against a fractional double literal', () => {
    const found = matches(`namespace Billing;
public class TaxCalculator
{
    public bool IsStandardRate(double rate)
    {
        return rate == 0.21;
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag zero sentinels, decimal literals, or epsilon comparisons', () => {
    const found = matches(`namespace Billing;
public class TaxCalculator
{
    public bool HasRate(double rate) => rate != 0.0;

    public bool IsStandardRate(decimal rate) => rate == 0.21m;

    public bool Approximately(double a, double b)
    {
        return Math.Abs(a - b) < 1e-9;
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/nan-comparison (C#)', () => {
  const key = 'bugs/deterministic/nan-comparison'

  it('detects == double.NaN which is always false', () => {
    const found = matches(`namespace Telemetry;
public class SensorReading
{
    public bool IsInvalid(double value)
    {
        return value == double.NaN;
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag double.IsNaN', () => {
    const found = matches(`namespace Telemetry;
public class SensorReading
{
    public bool IsInvalid(double value)
    {
        return double.IsNaN(value);
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/index-of-positive-check (C#)', () => {
  const key = 'bugs/deterministic/index-of-positive-check'

  it('detects IndexOf > 0 missing a match at index 0', () => {
    const found = matches(`namespace Storage;
public class PathInspector
{
    public bool HasExtension(string fileName)
    {
        return fileName.IndexOf('.') > 0;
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag the correct >= 0 found check', () => {
    const found = matches(`namespace Storage;
public class PathInspector
{
    public bool HasExtension(string fileName)
    {
        return fileName.IndexOf('.') >= 0;
    }

    public bool IsMissing(string fileName)
    {
        return fileName.IndexOf('.') < 0;
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/collection-size-mischeck (C#)', () => {
  const key = 'bugs/deterministic/collection-size-mischeck'

  it('detects Length compared to null and Count < 0', () => {
    const found = matches(`namespace Storage;
public class UploadValidator
{
    public bool HasContent(byte[] payload, List<string> tags)
    {
        if (payload.Length == null)
        {
            return false;
        }
        return tags.Count < 0;
    }
}
`, key)
    expect(found.length).toBe(2)
  })

  it('does not flag proper emptiness checks or nullable Count DTOs', () => {
    const found = matches(`namespace Storage;
public class UploadValidator
{
    public bool HasContent(byte[] payload, PageResponse page)
    {
        if (payload.Length == 0)
        {
            return false;
        }
        return page.Count != null && page.Count > 0;
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/string-format-mismatch (C#)', () => {
  const key = 'bugs/deterministic/string-format-mismatch'

  it('detects a format string referencing more arguments than provided', () => {
    const found = matches(`namespace Notifications;
public class ReceiptFormatter
{
    public string Format(string orderId, decimal total)
    {
        return string.Format("Order {0}: charged {1} to {2}", orderId, total);
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag matching counts, repeated indexes, or params arrays', () => {
    const found = matches(`namespace Notifications;
public class ReceiptFormatter
{
    public string Format(string orderId, decimal total, object[] extras)
    {
        var a = string.Format("Order {0}: charged {1}", orderId, total);
        var b = string.Format("{0} — see {0} above", orderId);
        var c = string.Format("Order {0} ({1})", extras);
        return a + b + c;
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/logging-args-mismatch (C#)', () => {
  const key = 'bugs/deterministic/logging-args-mismatch'

  it('detects extra and missing template arguments', () => {
    const found = matches(`namespace Notifications;
public class DispatchService
{
    public void Dispatch(Message message, int attempt, int maxAttempts)
    {
        _logger.LogWarning("Retrying dispatch attempt {Attempt}", attempt, maxAttempts);
        _logger.LogError("Failed to dispatch message {MessageId}");
    }
}
`, key)
    expect(found.length).toBe(2)
  })

  it('does not flag matching counts or the exception-first overload', () => {
    const found = matches(`namespace Notifications;
public class DispatchService
{
    public void Dispatch(Message message, int attempt)
    {
        try
        {
            _transport.Send(message);
            _logger.LogInformation("Dispatched {MessageId} on attempt {Attempt}", message.Id, attempt);
        }
        catch (TransportException ex)
        {
            _logger.LogError(ex, "Failed to dispatch {MessageId}", message.Id);
            throw;
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/duplicate-keys (C#)', () => {
  const key = 'bugs/deterministic/duplicate-keys'

  it('detects a duplicated key in a dictionary initializer', () => {
    const found = matches(`namespace Config;
public class DefaultSettings
{
    public static readonly Dictionary<string, string> Values = new Dictionary<string, string>
    {
        ["region"] = "eu-west-1",
        ["tier"] = "standard",
        ["region"] = "us-east-1",
    };
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag distinct keys in index or Add form', () => {
    const found = matches(`namespace Config;
public class DefaultSettings
{
    public static readonly Dictionary<string, string> Values = new Dictionary<string, string>
    {
        { "region", "eu-west-1" },
        { "tier", "standard" },
    };

    public static readonly Dictionary<string, int> Limits = new Dictionary<string, int>
    {
        ["requests"] = 100,
        ["uploads"] = 10,
    };
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/useless-exception-statement (C#)', () => {
  const key = 'bugs/deterministic/useless-exception-statement'

  it('detects an exception constructed but never thrown', () => {
    const found = matches(`namespace Billing;
public class OrderValidator
{
    public void Validate(Order order)
    {
        if (order.Items.Count == 0)
        {
            new InvalidOperationException("order has no line items");
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag thrown or assigned exceptions', () => {
    const found = matches(`namespace Billing;
public class OrderValidator
{
    public void Validate(Order order)
    {
        if (order.Items.Count == 0)
        {
            throw new InvalidOperationException("order has no line items");
        }
        var pending = new ValidationException("totals not yet reconciled");
        _deferred.Add(pending);
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/lost-error-context (C#)', () => {
  const key = 'bugs/deterministic/lost-error-context'

  it('detects throw ex; which resets the stack trace', () => {
    const found = matches(`namespace Billing;
public class PaymentService
{
    public void Charge(Payment payment)
    {
        try
        {
            _gateway.Submit(payment);
        }
        catch (GatewayException ex)
        {
            _logger.LogError(ex, "Charge failed for {PaymentId}", payment.Id);
            throw ex;
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag bare rethrow or wrapping with an inner exception', () => {
    const found = matches(`namespace Billing;
public class PaymentService
{
    public void Charge(Payment payment)
    {
        try
        {
            _gateway.Submit(payment);
        }
        catch (GatewayException ex)
        {
            _logger.LogError(ex, "Charge failed for {PaymentId}", payment.Id);
            throw;
        }
        catch (TimeoutException ex)
        {
            throw new PaymentFailedException("gateway timed out", ex);
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/exception-reassignment (C#)', () => {
  const key = 'bugs/deterministic/exception-reassignment'

  it('detects overwriting the caught exception variable', () => {
    const found = matches(`namespace Billing;
public class PaymentService
{
    public void Charge(Payment payment)
    {
        try
        {
            _gateway.Submit(payment);
        }
        catch (Exception ex)
        {
            ex = new PaymentFailedException("charge failed");
            _logger.LogError(ex, "Charge failed");
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag wrapping into a new variable', () => {
    const found = matches(`namespace Billing;
public class PaymentService
{
    public void Charge(Payment payment)
    {
        try
        {
            _gateway.Submit(payment);
        }
        catch (Exception ex)
        {
            var wrapped = new PaymentFailedException("charge failed", ex);
            _logger.LogError(wrapped, "Charge failed");
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/infinite-recursion (C#)', () => {
  const key = 'bugs/deterministic/infinite-recursion'

  it('detects a property getter that returns itself', () => {
    const found = matches(`namespace Config;
public class ConnectionSettings
{
    private string _connectionString;

    public string ConnectionString
    {
        get { return ConnectionString; }
        set { _connectionString = value; }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('detects a method that unconditionally calls itself with its own arguments', () => {
    const found = matches(`namespace Config;
public class CacheWarmer
{
    public void Warm(string region)
    {
        Warm(region);
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag overload delegation or structurally recursive methods', () => {
    const found = matches(`namespace Config;
public class AmountParser
{
    public decimal Parse(string raw)
    {
        return Parse(raw, CultureInfo.InvariantCulture);
    }

    public decimal Parse(string raw, CultureInfo culture)
    {
        return decimal.Parse(raw, culture);
    }

    public int CountNodes(TreeNode node)
    {
        if (node == null) return 0;
        return 1 + CountNodes(node.Left) + CountNodes(node.Right);
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/generic-error-message (C#)', () => {
  const key = 'bugs/deterministic/generic-error-message'

  it('detects a vague catch-all error message', () => {
    const found = matches(`namespace Api;
public class ErrorHandler
{
    public IActionResult Handle(Exception ex)
    {
        return StatusCode(500, "Something went wrong");
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag specific error messages', () => {
    const found = matches(`namespace Api;
public class ErrorHandler
{
    public IActionResult Handle(Exception ex)
    {
        return StatusCode(500, "Payment gateway rejected the card (code 4021)");
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/modified-loop-iterator (C#)', () => {
  const key = 'bugs/deterministic/modified-loop-iterator'

  it('detects removing from the collection being iterated', () => {
    const found = matches(`namespace Billing;
public class CartCleaner
{
    public void RemoveCancelled(List<CartItem> items)
    {
        foreach (var item in items)
        {
            if (item.IsCancelled)
            {
                items.Remove(item);
            }
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag iterating a snapshot or mutating a different collection', () => {
    const found = matches(`namespace Billing;
public class CartCleaner
{
    public void RemoveCancelled(List<CartItem> items)
    {
        foreach (var item in items.ToList())
        {
            if (item.IsCancelled)
            {
                items.Remove(item);
            }
        }
    }

    public void CollectCancelled(List<CartItem> items, List<CartItem> cancelled)
    {
        foreach (var item in items)
        {
            if (item.IsCancelled)
            {
                cancelled.Add(item);
            }
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/ignored-return-value (C#)', () => {
  const key = 'bugs/deterministic/ignored-return-value'

  it('detects discarding the result of a pure string method', () => {
    const found = matches(`namespace Imports;
public class RowNormalizer
{
    public string Normalize(string rawValue)
    {
        rawValue.Trim();
        return rawValue;
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('detects a LINQ pipeline used as a statement', () => {
    const found = matches(`namespace Imports;
public class RowFilter
{
    public void Apply(List<Row> rows)
    {
        rows.Where(r => r.IsValid);
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag assigned results or genuinely mutating calls', () => {
    const found = matches(`namespace Imports;
public class RowNormalizer
{
    public string Normalize(string rawValue, StringBuilder builder, List<Row> rows)
    {
        var trimmed = rawValue.Trim();
        builder.Replace("\\r\\n", "\\n");
        rows.Reverse();
        var valid = rows.Where(r => r.IsValid).ToList();
        return trimmed;
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/blocking-call-in-async (C#)', () => {
  const key = 'bugs/deterministic/blocking-call-in-async'

  it('detects .Result and Thread.Sleep inside an async method', () => {
    const found = matches(`namespace Sync;
public class ProfileLoader
{
    public async Task<Profile> LoadAsync(int userId)
    {
        var settings = _settingsClient.GetSettingsAsync(userId).Result;
        Thread.Sleep(200);
        return await _profileClient.GetProfileAsync(userId, settings);
    }
}
`, key)
    expect(found.length).toBe(2)
  })

  it('does not flag awaited calls, task-variable results after WhenAll, or sync contexts', () => {
    const found = matches(`namespace Sync;
public class ProfileLoader
{
    public async Task<Profile[]> LoadAllAsync(int[] userIds)
    {
        var tasks = userIds.Select(id => _profileClient.GetProfileAsync(id)).ToArray();
        await Task.WhenAll(tasks);
        return tasks.Select(t => t.Result).ToArray();
    }

    public Profile LoadBlocking(int userId)
    {
        Thread.Sleep(50);
        return _cache.Get(userId);
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/async-busy-wait (C#)', () => {
  const key = 'bugs/deterministic/async-busy-wait'

  it('detects polling with Thread.Sleep inside an async method', () => {
    const found = matches(`namespace Sync;
public class IndexWatcher
{
    public async Task WaitForIndexAsync()
    {
        while (!_index.IsReady)
        {
            Thread.Sleep(250);
        }
        await _notifier.NotifyAsync();
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag polling that awaits Task.Delay', () => {
    const found = matches(`namespace Sync;
public class IndexWatcher
{
    public async Task WaitForIndexAsync()
    {
        while (!_index.IsReady)
        {
            await Task.Delay(250);
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/async-void-function (C#)', () => {
  const key = 'bugs/deterministic/async-void-function'

  it('detects an async void method that is not an event handler', () => {
    const found = matches(`namespace Sync;
public class OrderSynchronizer
{
    public async void SyncAll()
    {
        var orders = await _repository.GetPendingAsync();
        await _gateway.PushAsync(orders);
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag event handlers, overrides, or async Task methods', () => {
    const found = matches(`namespace Sync;
public class SyncPage : ContentPage
{
    private async void OnSyncClicked(object sender, EventArgs e)
    {
        await SyncAllAsync();
    }

    protected override async void OnAppearing()
    {
        await RefreshAsync();
    }

    public async Task SyncAllAsync()
    {
        await _gateway.PushAsync(await _repository.GetPendingAsync());
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/missing-return-await (C#)', () => {
  const key = 'bugs/deterministic/missing-return-await'

  it('detects returning a task from inside a using block', () => {
    const found = matches(`namespace Data;
public class OrderRepository
{
    public Task<Order> GetOrderAsync(int id)
    {
        using (var connection = _factory.Open())
        {
            return connection.QuerySingleAsync<Order>("select * from orders where id = @id", new { id });
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('detects returning a task from inside a try with catch', () => {
    const found = matches(`namespace Data;
public class OrderService
{
    public Task<Order> LoadAsync(int id)
    {
        try
        {
            return _repository.GetOrderAsync(id);
        }
        catch (SqlException ex)
        {
            _logger.LogError(ex, "Failed to load order {Id}", id);
            throw;
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag return await or plain async passthrough', () => {
    const found = matches(`namespace Data;
public class OrderRepository
{
    public async Task<Order> GetOrderAsync(int id)
    {
        using (var connection = _factory.Open())
        {
            return await connection.QuerySingleAsync<Order>("select * from orders where id = @id", new { id });
        }
    }

    public Task<Order> GetCachedAsync(int id)
    {
        return _cache.GetOrCreateAsync(id);
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/switch-exhaustiveness (C#)', () => {
  const key = 'bugs/deterministic/switch-exhaustiveness'

  it('detects a switch missing members of a same-file enum with no default', () => {
    const found = matches(`namespace Billing;

public enum OrderStatus { Pending, Shipped, Delivered, Cancelled }

public class StatusNotifier
{
    public void Notify(Order order)
    {
        switch (order.Status)
        {
            case OrderStatus.Pending:
                _emails.SendPending(order);
                break;
            case OrderStatus.Shipped:
                _emails.SendShipped(order);
                break;
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag exhaustive switches or ones with a default arm', () => {
    const found = matches(`namespace Billing;

public enum OrderStatus { Pending, Shipped, Delivered, Cancelled }

public class StatusNotifier
{
    public void Notify(Order order)
    {
        switch (order.Status)
        {
            case OrderStatus.Pending:
                _emails.SendPending(order);
                break;
            default:
                _emails.SendGeneric(order);
                break;
        }
    }

    public string Label(OrderStatus status)
    {
        return status switch
        {
            OrderStatus.Pending => "pending",
            OrderStatus.Shipped => "shipped",
            OrderStatus.Delivered => "delivered",
            OrderStatus.Cancelled => "cancelled",
        };
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/unsafe-finally (C#)', () => {
  const key = 'bugs/deterministic/unsafe-finally'

  it('detects a throw inside a finally block', () => {
    const found = matches(`namespace Data;
public class TransactionRunner
{
    public void Run(Action work)
    {
        try
        {
            work();
        }
        finally
        {
            if (!_transaction.Committed)
            {
                throw new InvalidOperationException("transaction left uncommitted");
            }
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag a finally that only cleans up', () => {
    const found = matches(`namespace Data;
public class TransactionRunner
{
    public void Run(Action work)
    {
        try
        {
            work();
        }
        finally
        {
            _connection.Dispose();
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/element-overwrite (C#)', () => {
  const key = 'bugs/deterministic/element-overwrite'

  it('detects the same key assigned twice without an intervening read', () => {
    const found = matches(`namespace Exports;
public class HeaderWriter
{
    public void Write(Dictionary<string, string> headers)
    {
        headers["Content-Type"] = "application/json";
        headers["Content-Type"] = "text/csv";
        _client.Send(headers);
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag re-assignment after the value was read', () => {
    const found = matches(`namespace Exports;
public class HeaderWriter
{
    public void Write(Dictionary<string, string> headers)
    {
        headers["Content-Type"] = "application/json";
        _client.Send(headers);
        headers["Content-Type"] = "text/csv";
        _client.Send(headers);
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/base-to-string (C#)', () => {
  const key = 'bugs/deterministic/base-to-string'

  it('detects interpolating a same-file class without a ToString override', () => {
    const found = matches(`namespace Billing;

public class Order
{
    public int Id { get; set; }
    public decimal Total { get; set; }
}

public class OrderLogger
{
    public void LogSaved()
    {
        var order = new Order();
        Console.WriteLine($"saved order {order}");
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag types with ToString, records, or member interpolation', () => {
    const found = matches(`namespace Billing;

public record Money(decimal Amount, string Currency);

public class Order
{
    public int Id { get; set; }
    public override string ToString() => $"Order #{Id}";
}

public class OrderLogger
{
    public void LogSaved(Money price)
    {
        var order = new Order();
        Console.WriteLine($"saved order {order} at {price} ({order.Id})");
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/nested-try-catch (C#)', () => {
  const key = 'bugs/deterministic/nested-try-catch'

  it('detects a try/catch nested inside a catch handler', () => {
    const found = matches(`namespace Data;
public class BackupWriter
{
    public void Write(Snapshot snapshot)
    {
        try
        {
            _primary.Save(snapshot);
        }
        catch (StorageException)
        {
            try
            {
                _secondary.Save(snapshot);
            }
            catch (StorageException ex)
            {
                _logger.LogError(ex, "Both backup targets failed");
            }
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag sequential try/catch blocks', () => {
    const found = matches(`namespace Data;
public class BackupWriter
{
    public void Write(Snapshot snapshot)
    {
        try
        {
            _primary.Save(snapshot);
        }
        catch (StorageException ex)
        {
            _logger.LogWarning(ex, "Primary save failed");
        }

        try
        {
            _secondary.Save(snapshot);
        }
        catch (StorageException ex)
        {
            _logger.LogError(ex, "Secondary save failed");
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/invalid-regexp (C#)', () => {
  const key = 'bugs/deterministic/invalid-regexp'

  it('detects a pattern with unbalanced parentheses that throws ArgumentException', () => {
    const found = matches(`namespace Releases;
public class VersionParser
{
    private static readonly Regex VersionPattern = new Regex(@"v(\\d+\\.\\d+");

    public bool IsVersionTag(string tag) => VersionPattern.IsMatch(tag);
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag .NET-specific constructs that are valid', () => {
    const found = matches(`namespace Http;
public class HeaderMatcher
{
    private static readonly Regex ContentType = new Regex(@"(?i)^content-type$");
    private static readonly Regex Placeholder = new Regex(@"\\{(\\d+)\\}");
    private static readonly Regex Lazy = new Regex(@"<p>.*?</p>");
    private static readonly Regex Bounded = new Regex(@"\\d{2,4}-\\d{2}");

    public bool HasClosingBracket(string token) => Regex.IsMatch(token, @"[]]");
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/empty-character-class (C#)', () => {
  const key = 'bugs/deterministic/empty-character-class'

  it('detects an empty character class, which throws in .NET', () => {
    const found = matches(`namespace Imports;
public class RowSplitter
{
    public string[] Split(string line)
    {
        return Regex.Split(line, @"[]+");
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag classes containing escaped or literal brackets', () => {
    const found = matches(`namespace Imports;
public class RowSplitter
{
    public string[] Split(string line)
    {
        return Regex.Split(line, @"[\\[\\]]+");
    }

    public bool EndsArray(string token) => Regex.IsMatch(token, @"[]]");
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/control-chars-in-regex (C#)', () => {
  const key = 'bugs/deterministic/control-chars-in-regex'

  it('detects a raw control character pasted into a pattern literal', () => {
    const found = matches(`namespace Feeds;
public class RecordParser
{
    private static readonly Regex FieldSplit = new Regex("ID\x01[0-9]+");
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag deliberate escape sequences for control characters', () => {
    const found = matches(`namespace Feeds;
public class RecordParser
{
    private static readonly Regex FieldSplit = new Regex("ID\\x01[0-9]+");
    private static readonly Regex TabSplit = new Regex(@"\\t+");
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/misleading-character-class (C#)', () => {
  const key = 'bugs/deterministic/misleading-character-class'

  it('detects an emoji inside a character class (matches surrogate halves in .NET)', () => {
    const found = matches(`namespace Chat;
public class ReactionFilter
{
    private static readonly Regex Reactions = new Regex("[\u{1F600}\u{1F622}]");
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag emojis outside character classes or plain ASCII classes', () => {
    const found = matches(`namespace Chat;
public class ReactionFilter
{
    private static readonly Regex Grinning = new Regex("\u{1F600}+");
    private static readonly Regex Slug = new Regex("[a-z0-9-]+");
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/useless-backreference (C#)', () => {
  const key = 'bugs/deterministic/useless-backreference'

  it('detects a backreference placed before the group it references', () => {
    const found = matches(`namespace Text;
public class DuplicateWordFinder
{
    private static readonly Regex DupWord = new Regex(@"\\1\\s+(\\w+)");
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag a backreference after its group', () => {
    const found = matches(`namespace Text;
public class DuplicateWordFinder
{
    private static readonly Regex DupWord = new Regex(@"(\\w+)\\s+\\1");
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/regex-backreference-invalid (C#)', () => {
  const key = 'bugs/deterministic/regex-backreference-invalid'

  it('detects a backreference to a group that does not exist', () => {
    const found = matches(`namespace Logs;
public partial class TimestampParser
{
    [GeneratedRegex(@"(\\d{2}):\\2")]
    private static partial Regex TimePattern();
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag valid numeric and named backreferences', () => {
    const found = matches(`namespace Logs;
public class TimestampParser
{
    private static readonly Regex Pair = new Regex(@"(\\d{2}):(\\d{2})\\2");
    private static readonly Regex Named = new Regex(@"(?<h>\\d{2}):\\k<h>");
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/regex-alternatives-redundant (C#)', () => {
  const key = 'bugs/deterministic/regex-alternatives-redundant'

  it('detects a duplicated alternative', () => {
    const found = matches(`namespace Logs;
public class LevelMatcher
{
    private static readonly Regex Levels = new Regex("error|warn|error");
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag distinct alternatives', () => {
    const found = matches(`namespace Logs;
public class LevelMatcher
{
    private static readonly Regex Levels = new Regex("debug|info|notice");
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/regex-boundary-unmatchable (C#)', () => {
  const key = 'bugs/deterministic/regex-boundary-unmatchable'

  it('detects literal content after the end-of-string anchor', () => {
    const found = matches(`namespace Jobs;
public class StatusMatcher
{
    public bool IsDone(string line) => Regex.IsMatch(line, @"^done$now");
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag normal anchor and word-boundary usage', () => {
    const found = matches(`namespace Jobs;
public class StatusMatcher
{
    public bool IsWord(string line) => Regex.IsMatch(line, @"^\\w+$");
    public bool HasTodo(string line) => Regex.IsMatch(line, @"\\bTODO\\b");
    public bool HasPrice(string line) => Regex.IsMatch(line, @"costs \\$5 total");
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/regex-lookahead-contradictory (C#)', () => {
  const key = 'bugs/deterministic/regex-lookahead-contradictory'

  it('detects a positive lookahead contradicted by a negative one', () => {
    const found = matches(`namespace Auth;
public class PasswordPolicy
{
    private static readonly Regex Impossible = new Regex(@"^(?=\\d)(?!\\d)\\w{6,}$");
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag the standard multi-lookahead password pattern', () => {
    const found = matches(`namespace Auth;
public class PasswordPolicy
{
    private static readonly Regex Strong = new Regex(@"^(?=.*\\d)(?=.*[a-z])\\w{8,}$");
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/regex-possessive-always-fails (C#)', () => {
  const key = 'bugs/deterministic/regex-possessive-always-fails'

  it('detects an atomic group followed by content it already consumed', () => {
    const found = matches(`namespace Lexing;
public class IdentifierScanner
{
    private static readonly Regex Ident = new Regex(@"(?>\\w+)x");
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag atomic groups followed by non-overlapping content', () => {
    const found = matches(`namespace Lexing;
public class IdentifierScanner
{
    private static readonly Regex Quoted = new Regex(@"(?>'[^']*')\\s");
    private static readonly Regex Number = new Regex(@"(?>\\d+)[a-z]");
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/regex-group-reference-mismatch (C#)', () => {
  const key = 'bugs/deterministic/regex-group-reference-mismatch'

  it('detects a replacement referencing a group beyond the pattern count', () => {
    const found = matches(`namespace Privacy;
public class EmailMasker
{
    public string Mask(string email)
    {
        return Regex.Replace(email, @"(\\w+)@(\\w+\\.\\w+)", "$1 at $3");
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag valid group references or literal dollar text', () => {
    const found = matches(`namespace Privacy;
public class EmailMasker
{
    public string Mask(string email)
    {
        return Regex.Replace(email, @"(\\w+)@(\\w+\\.\\w+)", "$1 at $2");
    }

    public string FixPrice(string label)
    {
        return Regex.Replace(label, @"\\d+\\.\\d{2}", "$5.00");
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/cancellation-exception-not-reraised (C#)', () => {
  const key = 'bugs/deterministic/cancellation-exception-not-reraised'

  it('detects OperationCanceledException swallowed inside an unconditional worker loop', () => {
    const found = matches(`namespace Workers;
public class QueueWorker
{
    public async Task RunAsync(CancellationToken token)
    {
        while (true)
        {
            try
            {
                await ProcessNextAsync(token);
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation("Processing cancelled");
            }
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag token-checked loops, catch-and-break, or top-level graceful shutdown', () => {
    const found = matches(`namespace Workers;
public class QueueWorker
{
    public async Task RunAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try { await ProcessNextAsync(token); }
            catch (OperationCanceledException) { }
        }
    }

    public async Task PollAsync(CancellationToken token)
    {
        while (true)
        {
            try { await ProcessNextAsync(token); }
            catch (OperationCanceledException) { break; }
        }
    }

    public async Task ShutdownAsync()
    {
        try { await _worker.LoopAsync(_cts.Token); }
        catch (OperationCanceledException) { }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/datetime-without-timezone (C#)', () => {
  const key = 'bugs/deterministic/datetime-without-timezone'

  it('detects comparing a UTC timestamp against local DateTime.Now', () => {
    const found = matches(`namespace Sessions;
public class SessionValidator
{
    public bool IsExpired(Session session)
    {
        return session.ExpiresUtc < DateTime.Now;
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag local-time display, UTC-consistent math, or the offset idiom', () => {
    const found = matches(`namespace Sessions;
public class SessionValidator
{
    public bool IsExpired(Session session)
    {
        return session.ExpiresUtc < DateTime.UtcNow;
    }

    public string CurrentClock()
    {
        return DateTime.Now.ToString("HH:mm");
    }

    public TimeSpan LocalOffset()
    {
        return DateTime.Now - DateTime.UtcNow;
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/decimal-from-float (C#)', () => {
  const key = 'bugs/deterministic/decimal-from-float'

  it('detects casting a double literal to decimal', () => {
    const found = matches(`namespace Billing;
public class PriceCalculator
{
    public decimal ApplyDiscount(decimal price)
    {
        var rate = (decimal)0.1;
        return price * (1m - rate);
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag decimal literals or deliberate conversions of variables', () => {
    const found = matches(`namespace Billing;
public class PriceCalculator
{
    public decimal ApplyDiscount(decimal price, double exchangeRate)
    {
        var rate = 0.1m;
        var converted = (decimal)exchangeRate;
        var fromDb = Convert.ToDecimal(_reader["price"]);
        return price * (1m - rate) * converted + fromDb;
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/non-existent-operator (C#)', () => {
  const key = 'bugs/deterministic/non-existent-operator'

  it('detects the =- typo where -= was intended', () => {
    const found = matches(`namespace Accounts;
public class Wallet
{
    private decimal _balance;

    public void Withdraw(decimal amount)
    {
        _balance =- amount;
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag intentional unary operators in assignments', () => {
    const found = matches(`namespace Accounts;
public class Wallet
{
    public void Reset(decimal amount, bool flag)
    {
        var balance = -amount;
        var index=-1;
        var enabled = !flag;
        balance = -balance;
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/bidirectional-unicode (C#)', () => {
  const key = 'bugs/deterministic/bidirectional-unicode'

  it('detects a right-to-left override character hidden in a string', () => {
    const found = matches(`namespace Uploads;
public class FileValidator
{
    public bool IsSafe(string name)
    {
        return name != "invoice\u202Egnp.exe";
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag normal source files', () => {
    const found = matches(`namespace Uploads;
public class FileValidator
{
    public bool IsSafe(string name)
    {
        return !name.EndsWith(".exe");
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/invisible-whitespace (C#)', () => {
  const key = 'bugs/deterministic/invisible-whitespace'

  it('detects a non-breaking space inside a string literal', () => {
    const found = matches(`namespace Http;
public class HeaderBuilder
{
    public string ContentTypeKey()
    {
        return "Content\u00A0Type";
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag regular spaces', () => {
    const found = matches(`namespace Http;
public class HeaderBuilder
{
    public string ContentTypeKey()
    {
        return "Content Type";
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/invalid-character-in-source (C#)', () => {
  const key = 'bugs/deterministic/invalid-character-in-source'

  it('detects a zero-width space embedded in the source', () => {
    const found = matches(`namespace Ids;
public class TokenFactory
{
    public string Prefix()
    {
        return "abc\u200Bdef";
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag a UTF-8 BOM at the start of the file', () => {
    const found = matches(`\uFEFFnamespace Ids;
public class TokenFactory
{
    public string Prefix()
    {
        return "abcdef";
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/loss-of-precision (C#)', () => {
  const key = 'bugs/deterministic/loss-of-precision'

  it('detects a double literal beyond 2^53 that is silently rounded', () => {
    const found = matches(`namespace Interop;
public class JsBridge
{
    public double MaxSafeIntegerPlusTwo()
    {
        return 9007199254740993.0;
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag representable literals, fractions, or decimal literals', () => {
    const found = matches(`namespace Interop;
public class JsBridge
{
    public void Compute()
    {
        var ratio = 0.1;
        var maxSafe = 9007199254740992.0;
        var price = 79228162514264337593543950.335m;
        var ticks = 9223372036854775807;
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/constant-binary-expression (C#)', () => {
  const key = 'bugs/deterministic/constant-binary-expression'

  it('detects a boolean literal that fixes the result of a condition', () => {
    const found = matches(`namespace Tracing;
public class TraceGate
{
    public bool ShouldTrace(Request request)
    {
        return request.Debug || true;
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag literal arithmetic, string concatenation, or real conditions', () => {
    const found = matches(`namespace Tracing;
public class TraceGate
{
    public void Configure(int retries, int maxRetries)
    {
        var secondsPerDay = 24 * 60 * 60;
        var banner = "TrueCourse" + " v2";
        if (retries < maxRetries)
        {
            _scheduler.Requeue();
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/confusing-increment-decrement (C#)', () => {
  const key = 'bugs/deterministic/confusing-increment-decrement'

  it('detects ++ buried inside an arithmetic expression', () => {
    const found = matches(`namespace Hashing;
public class ChecksumBuilder
{
    public int Mix(int seed, byte[] block)
    {
        var checksum = seed++ + block.Length;
        return checksum;
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag loop counters or index-and-advance idioms', () => {
    const found = matches(`namespace Hashing;
public class ChecksumBuilder
{
    public void Copy(byte[] items, byte[] buffer)
    {
        var cursor = 0;
        for (var i = 0; i < items.Length; i++)
        {
            buffer[cursor++] = items[i];
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/new-object-identity-check (C#)', () => {
  const key = 'bugs/deterministic/new-object-identity-check'

  it('detects ReferenceEquals against a freshly constructed object', () => {
    const found = matches(`namespace Config;
public class SettingsManager
{
    public void Reload(Settings current)
    {
        if (ReferenceEquals(current, new Settings()))
        {
            ApplyDefaults();
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag reference comparisons between existing instances', () => {
    const found = matches(`namespace Config;
public class SettingsManager
{
    public bool IsDefault(Settings current)
    {
        if (ReferenceEquals(current, null)) return true;
        return ReferenceEquals(current, _defaultSettings);
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/race-condition-assignment (C#)', () => {
  const key = 'bugs/deterministic/race-condition-assignment'

  it('detects a shared field updated with += across an await', () => {
    const found = matches(`namespace Downloads;
public class DownloadTracker
{
    private long _totalBytes;

    public async Task TrackAsync(Stream stream)
    {
        _totalBytes += await ReadChunkAsync(stream);
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag locals accumulated across awaits', () => {
    const found = matches(`namespace Downloads;
public class DownloadTracker
{
    public async Task<int> SumAsync(IEnumerable<string> urls)
    {
        var total = 0;
        foreach (var url in urls)
        {
            total += await FetchCountAsync(url);
        }
        return total;
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/reduce-missing-initial (C#)', () => {
  const key = 'bugs/deterministic/reduce-missing-initial'

  it('detects Aggregate without a seed', () => {
    const found = matches(`namespace Billing;
public class InvoiceTotals
{
    public decimal Total(Order order)
    {
        return order.Lines.Select(l => l.Amount).Aggregate((a, b) => a + b);
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag Aggregate with a seed', () => {
    const found = matches(`namespace Billing;
public class InvoiceTotals
{
    public decimal Total(Order order)
    {
        return order.Lines.Aggregate(0m, (acc, l) => acc + l.Amount);
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/useless-finally (C#)', () => {
  const key = 'bugs/deterministic/useless-finally'

  it('detects an empty finally block', () => {
    const found = matches(`namespace Storage;
public class SnapshotWriter
{
    public void Save(Snapshot snapshot)
    {
        try
        {
            _store.Write(snapshot);
        }
        catch (IOException ex)
        {
            _logger.LogError(ex, "Write failed");
        }
        finally
        {
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag finally blocks that release resources', () => {
    const found = matches(`namespace Storage;
public class SnapshotWriter
{
    public void Save(Snapshot snapshot)
    {
        try
        {
            _store.Write(snapshot);
        }
        finally
        {
            _connection.Dispose();
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/fstring-missing-placeholders (C#)', () => {
  const key = 'bugs/deterministic/fstring-missing-placeholders'

  it('detects an interpolated string with no holes', () => {
    const found = matches(`namespace Deploys;
public class DeployReporter
{
    public void Report()
    {
        Console.WriteLine($"Deployment complete");
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag interpolations with holes or split interpolation chains', () => {
    const found = matches(`namespace Deploys;
public class DeployReporter
{
    public void Report(int count, string buildId)
    {
        Console.WriteLine($"Deployed {count} services");
        var msg = $"Build " + $"{buildId} finished";
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/lowercase-environment-variable (C#)', () => {
  const key = 'bugs/deterministic/lowercase-environment-variable'

  it('detects a lowercase environment variable key', () => {
    const found = matches(`namespace Config;
public class ConnectionFactory
{
    public string ConnectionString()
    {
        return Environment.GetEnvironmentVariable("database_url");
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag UPPER_CASE keys or well-known lowercase variables', () => {
    const found = matches(`namespace Config;
public class ConnectionFactory
{
    public string ConnectionString()
    {
        var proxy = Environment.GetEnvironmentVariable("https_proxy");
        return Environment.GetEnvironmentVariable("DATABASE_URL");
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/duplicate-set-value (C#)', () => {
  const key = 'bugs/deterministic/duplicate-set-value'

  it('detects a duplicated element in a HashSet initializer', () => {
    const found = matches(`namespace Http;
public class MethodPolicy
{
    private static readonly HashSet<string> Idempotent = new HashSet<string> { "GET", "HEAD", "PUT", "GET" };
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag distinct set elements or dictionary initializers', () => {
    const found = matches(`namespace Http;
public class MethodPolicy
{
    private static readonly HashSet<string> Idempotent = new HashSet<string> { "GET", "HEAD", "PUT", "DELETE" };
    private static readonly Dictionary<string, int> Limits = new Dictionary<string, int> { { "GET", 100 }, { "POST", 20 } };
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/empty-collection-access (C#)', () => {
  const key = 'bugs/deterministic/empty-collection-access'

  it('detects indexing a freshly constructed empty list', () => {
    const found = matches(`namespace Imports;
public class HeaderReader
{
    public string FirstHeader()
    {
        return new List<string>()[0];
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag populated initializers or sized buffers', () => {
    const found = matches(`namespace Imports;
public class HeaderReader
{
    public void Read()
    {
        var first = new List<string> { "alpha" }[0];
        var pooled = new List<string>(_capacity);
        var buffer = new byte[1024];
        var head = buffer[0];
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/potential-index-error (C#)', () => {
  const key = 'bugs/deterministic/potential-index-error'

  it('detects a constant index beyond the literal collection size', () => {
    const found = matches(`namespace Reporting;
public class QuarterPlanner
{
    public string LastQuarter()
    {
        return new[] { "Mar", "Jun", "Sep", "Dec" }[4];
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag in-range indexes including from-end indexing', () => {
    const found = matches(`namespace Reporting;
public class QuarterPlanner
{
    public void Plan()
    {
        var first = new[] { "Mar", "Jun", "Sep", "Dec" }[0];
        var last = new[] { "Mar", "Jun", "Sep", "Dec" }[^1];
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/arguments-order-mismatch (C#)', () => {
  const key = 'bugs/deterministic/arguments-order-mismatch'

  it('detects passing the receiver itself as the needle', () => {
    const found = matches(`namespace Routing;
public class PathFilter
{
    public bool IsUnderRoot(string requestPath)
    {
        return requestPath.StartsWith(requestPath);
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag normal needle arguments', () => {
    const found = matches(`namespace Routing;
public class PathFilter
{
    public bool IsUnderRoot(string requestPath, string basePath)
    {
        return requestPath.StartsWith(basePath);
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/invariant-return (C#)', () => {
  const key = 'bugs/deterministic/invariant-return'

  it('detects a method that returns the same literal from every branch', () => {
    const found = matches(`namespace Orders;
public class OrderValidator
{
    public bool Validate(Order order)
    {
        if (order.Items.Count == 0) return false;
        if (order.Total < 0) return false;
        return false;
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag varied returns or Try-pattern methods with out parameters', () => {
    const found = matches(`namespace Orders;
public class OrderValidator
{
    public bool Validate(Order order)
    {
        if (order.Items.Count == 0) return false;
        if (order.Total < 0) return false;
        return true;
    }

    public bool TryGetDiscount(string code, out decimal rate)
    {
        if (_rates.TryGetValue(code, out rate)) return true;
        rate = 0m;
        return true;
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/type-comparison-instead-of-isinstance (C#)', () => {
  const key = 'bugs/deterministic/type-comparison-instead-of-isinstance'

  it('detects GetType() == typeof(T) in polymorphic dispatch', () => {
    const found = matches(`namespace Payments;
public class FeeCalculator
{
    public decimal GetFee(Payment payment)
    {
        if (payment.GetType() == typeof(CardPayment))
        {
            return payment.Amount * 0.029m;
        }
        return 0m;
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag exact-type checks inside Equals overrides or pattern matching', () => {
    const found = matches(`namespace Payments;
public class Money
{
    public override bool Equals(object obj)
    {
        if (obj == null || obj.GetType() != typeof(Money)) return false;
        var other = (Money)obj;
        return Amount == other.Amount;
    }

    public bool IsCard(Payment payment) => payment is CardPayment;
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/useless-increment (C#)', () => {
  const key = 'bugs/deterministic/useless-increment'

  it('detects x = x++ which leaves the variable unchanged', () => {
    const found = matches(`namespace Retry;
public class RetryPolicy
{
    public void RecordFailure()
    {
        _attempts = _attempts++;
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag standalone increments or assigning another variable', () => {
    const found = matches(`namespace Retry;
public class RetryPolicy
{
    public int NextTicket()
    {
        _attempts++;
        var ticket = _counter++;
        return ticket;
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/unused-loop-variable (C#)', () => {
  const key = 'bugs/deterministic/unused-loop-variable'

  it('detects a foreach variable never used in the body', () => {
    const found = matches(`namespace Caching;
public class CacheWarmer
{
    public void WarmUp()
    {
        foreach (var attempt in Enumerable.Range(0, 3))
        {
            _cache.Refresh();
            Thread.Sleep(100);
        }
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag used variables or the discard convention', () => {
    const found = matches(`namespace Caching;
public class CacheWarmer
{
    public void WarmUp(IEnumerable<Order> orders)
    {
        foreach (var order in orders)
        {
            Process(order);
        }

        foreach (var _ in Enumerable.Range(0, 3))
        {
            _cache.Refresh();
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/assert-raises-too-broad (C#)', () => {
  const key = 'bugs/deterministic/assert-raises-too-broad'

  it('detects ExpectedException and discarded Throws pinned to the base Exception type', () => {
    const found = matches(`namespace Billing.Tests;
public class RefundServiceTests
{
    [TestMethod]
    [ExpectedException(typeof(Exception))]
    public void Refund_NegativeAmount_Throws()
    {
        _service.Refund(_order, -5m);
    }

    [Test]
    public void Activate_MissingPlan_Throws()
    {
        Assert.Throws(typeof(Exception), () => _service.Activate(null));
    }
}
`, key)
    expect(found.length).toBe(2)
  })

  it('does not flag specific exception types or captured-and-asserted results', () => {
    const found = matches(`namespace Billing.Tests;
public class RefundServiceTests
{
    [TestMethod]
    [ExpectedException(typeof(InvalidOperationException))]
    public void Refund_AlreadyRefunded_Throws()
    {
        _service.Refund(_order, 5m);
    }

    [TestMethod]
    public void Activate_MissingPlan_Throws()
    {
        Assert.ThrowsException<ArgumentNullException>(() => _service.Activate(null));

        var ex = Assert.ThrowsException<Exception>(() => _service.Activate(null));
        Assert.AreEqual("plan is required", ex.Message);
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/bare-except (C#)', () => {
  const key = 'bugs/deterministic/bare-except'

  it('detects catch-all blocks that do work and continue without binding, logging, or rethrowing', () => {
    const found = matches(`namespace Import;
public class CsvImporter
{
    public void ImportAll(IEnumerable<CsvRow> rows)
    {
        foreach (var row in rows)
        {
            try
            {
                _writer.Insert(MapRow(row));
            }
            catch
            {
                _skippedRows++;
                _lastSkippedLine = row.LineNumber;
            }
        }
    }

    public void Reindex(Document document)
    {
        try
        {
            _index.Update(document);
        }
        catch (Exception)
        {
            _staleDocuments.Add(document.Id);
            _indexDirty = true;
        }
    }
}
`, key)
    expect(found.length).toBe(2)
  })

  it('does not flag TryX wrappers, fallbacks, retries, logging, or bound exceptions', () => {
    const found = matches(`namespace Import;
public class ManifestLoader
{
    public bool TryLoadManifest(string path, out Manifest manifest)
    {
        try
        {
            manifest = Manifest.Parse(File.ReadAllText(path));
            return true;
        }
        catch
        {
            manifest = null;
            return false;
        }
    }

    public Config LoadConfig(string path)
    {
        try { return Config.Parse(path); }
        catch { return Config.Default; }
    }

    public void Connect()
    {
        while (_attempt < 3)
        {
            try { _channel.Open(); return; }
            catch
            {
                Thread.Sleep(200 * _attempt);
                _attempt++;
            }
        }
    }

    public void Sync(Invoice invoice)
    {
        try
        {
            _gateway.Push(invoice);
        }
        catch (Exception ex)
        {
            _failures.Add(ex.Message);
            _gatewayHealthy = false;
        }
    }

    public void Audit(Entry entry)
    {
        try
        {
            _store.Append(entry);
        }
        catch
        {
            Console.Error.WriteLine("audit append failed");
            _auditFailures++;
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/datetime-12h-format-without-ampm (C#)', () => {
  const key = 'bugs/deterministic/datetime-12h-format-without-ampm'

  it('detects hh (12-hour) formats without a tt designator', () => {
    const found = matches(`namespace Scheduling;
public class PickupNotifier
{
    public string FormatSlot(DeliverySlot slot)
    {
        var stamp = slot.Start.ToString("hh:mm");
        return $"Pickup between {slot.Start:hh:mm} and {slot.End:HH:mm}";
    }
}
`, key)
    expect(found.length).toBe(2)
  })

  it('does not flag 24-hour formats, hh with tt, or TimeSpan formats', () => {
    const found = matches(`namespace Scheduling;
public class PickupNotifier
{
    public string FormatSlot(DeliverySlot slot, TimeSpan elapsed)
    {
        var opens = slot.Start.ToString("HH:mm");
        var friendly = slot.Start.ToString("hh:mm tt");
        var spent = elapsed.ToString(@"hh\\:mm");
        var banner = string.Format("Window {0:HH:mm} - {1:hh:mm tt}", slot.Start, slot.End);
        return $"{opens} ({friendly}, {elapsed:hh\\\\:mm} elapsed) {banner}";
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/datetime-constructor-range (C#)', () => {
  const key = 'bugs/deterministic/datetime-constructor-range'

  it('detects constant date/time components outside their legal range', () => {
    const found = matches(`namespace Billing;
public class FiscalCalendar
{
    public DateTime YearEndClose()
    {
        return new DateTime(2024, 13, 1);
    }

    public TimeOnly MaintenanceWindowEnd()
    {
        return new TimeOnly(24, 0);
    }
}
`, key)
    expect(found.length).toBe(2)
  })

  it('does not flag valid components, ticks constructors, or kind/offset arguments', () => {
    const found = matches(`namespace Billing;
public class FiscalCalendar
{
    public DateTime YearEnd() => new DateTime(2024, 12, 31, 23, 59, 59);

    public DateTime FromTicks(long ticks) => new DateTime(637843212000000000);

    public DateTime UtcStamp() => new DateTime(2024, 3, 15, 10, 0, 0, DateTimeKind.Utc);

    public DateTimeOffset RegionalOpen() => new DateTimeOffset(2024, 1, 15, 9, 30, 0, TimeSpan.FromHours(2));
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/in-empty-collection (C#)', () => {
  const key = 'bugs/deterministic/in-empty-collection'

  it('detects membership tests against collections that are empty by construction', () => {
    const found = matches(`namespace Access;
public class FeatureGate
{
    public bool IsBetaTester(User user)
    {
        return Array.Empty<string>().Contains(user.Email);
    }

    public bool HasPendingOrder(Order order)
    {
        return new List<int>().Contains(order.Id);
    }
}
`, key)
    expect(found.length).toBe(2)
  })

  it('does not flag populated collections, copy constructors, or seeded initializers', () => {
    const found = matches(`namespace Access;
public class FeatureGate
{
    public bool IsAllowed(string role, IEnumerable<string> seedRoles)
    {
        if (_allowedRoles.Contains(role)) return true;
        if (new List<string>(seedRoles).Contains(role)) return true;
        if (new[] { "admin", "ops" }.Contains(role)) return true;
        return new HashSet<string> { "auditor" }.Contains(role);
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/loop-at-most-one-iteration (C#)', () => {
  const key = 'bugs/deterministic/loop-at-most-one-iteration'

  it('detects a loop whose first iteration exits on every path', () => {
    const code = `namespace Migrations;
public class MigrationRunner
{
    public MigrationResult ApplyPending(IReadOnlyList<Migration> pending)
    {
        foreach (var migration in pending)
        {
            if (migration.IsDestructive)
                return MigrationResult.Blocked(migration);
            else
                return MigrationResult.Applied(Run(migration));
        }
        return MigrationResult.NoOp();
    }
}
`
    expect(matches(code, key).length).toBe(1)
    // The trailing-exit shape belongs to unreachable-loop — no double-fire.
    expect(matches(code, 'bugs/deterministic/unreachable-loop').length).toBe(0)
  })

  it('does not flag find-first loops or the shape owned by unreachable-loop', () => {
    const found = matches(`namespace Migrations;
public class MigrationRunner
{
    public MigrationResult ApplyFirst(IReadOnlyList<Migration> pending)
    {
        foreach (var migration in pending)
        {
            if (migration.IsReady)
                return MigrationResult.Applied(Run(migration));
        }

        while (_retries < 3)
        {
            Connect();
            break;
        }

        return MigrationResult.NoOp();
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/missing-fstring-syntax (C#)', () => {
  const key = 'bugs/deterministic/missing-fstring-syntax'

  it('detects a plain string with {holes} naming in-scope locals and parameters', () => {
    const found = matches(`namespace Notifications;
public class GreetingBuilder
{
    public string BuildGreeting(string userName)
    {
        var count = _orders.Count(o => o.UserName == userName);
        return "Welcome back {userName}, you have {count} open orders";
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag route templates, logger message templates, JSON, or composite formats', () => {
    const found = matches(`namespace Notifications;
public class SessionsController
{
    [HttpGet("sessions/{id}")]
    public Session GetSession(int id) => _store.Find(id);

    public void Purge(int jobId)
    {
        var removed = _store.PurgeStale(jobId);
        _logger.LogWarning("Retrying job {jobId} after failure", jobId);
        var payload = "{\\"name\\": \\"unknown\\"}";
        var body = string.Format("Purged {0} sessions for job {1}", removed, jobId);
        var sql = @"SELECT {placeholder} FROM sessions";
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/static-key-dict-comprehension (C#)', () => {
  const key = 'bugs/deterministic/static-key-dict-comprehension'

  it('detects ToDictionary with a constant key selector', () => {
    const found = matches(`namespace Config;
public class SettingsLoader
{
    public Dictionary<string, string> Load(IEnumerable<SettingEntry> entries)
    {
        return entries.ToDictionary(e => "setting", e => e.Value);
    }
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag key selectors derived from the element', () => {
    const found = matches(`namespace Config;
public class SettingsLoader
{
    public Dictionary<string, string> Load(IEnumerable<SettingEntry> entries)
    {
        var byKey = entries.ToDictionary(e => e.Key, e => e.Value);
        var byName = entries.ToDictionary(e => e.Name.ToLowerInvariant());
        return byKey;
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/unraw-re-pattern (C#)', () => {
  const key = 'bugs/deterministic/unraw-re-pattern'

  it('detects \\b compiled as backspace in non-verbatim regex patterns', () => {
    const found = matches(`namespace Lint;
public class TodoScanner
{
    private static readonly Regex TodoPattern = new Regex("\\bTODO\\b");

    public bool EndsWithKeyword(string line)
    {
        return Regex.IsMatch(line, "end\\b");
    }
}
`, key)
    expect(found.length).toBe(2)
  })

  it('does not flag verbatim patterns or properly doubled backslashes', () => {
    const found = matches(`namespace Lint;
public class TodoScanner
{
    private static readonly Regex TodoPattern = new Regex(@"\\bTODO\\b");
    private static readonly Regex WordPattern = new Regex("\\\\bTODO\\\\b");

    public string[] SplitLines(string text)
    {
        return Regex.Split(text, "\\r?\\n");
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})

describe('bugs/deterministic/empty-finalizer (C#)', () => {
  const key = 'bugs/deterministic/empty-finalizer'

  it('flags a finalizer whose body is empty', () => {
    const found = matches(`namespace Caching;
public sealed class FileCache
{
    private readonly Dictionary<string, byte[]> _entries = new();

    ~FileCache()
    {
    }

    public void Add(string key, byte[] value) => _entries[key] = value;
}
`, key)
    expect(found.length).toBe(1)
  })

  it('does not flag a finalizer that releases resources or one with real cleanup', () => {
    const found = matches(`namespace Caching;
public sealed class NativeBuffer
{
    private IntPtr _handle;

    ~NativeBuffer()
    {
        if (_handle != IntPtr.Zero)
        {
            Marshal.FreeHGlobal(_handle);
            _handle = IntPtr.Zero;
        }
    }
}
`, key)
    expect(found.length).toBe(0)
  })
})
