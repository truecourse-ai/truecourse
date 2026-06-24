using System.Threading.Tasks;

namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// Computes invoice totals and persists them. The body carries a few local-variable
/// and async smells accumulated over time.
/// </summary>
internal sealed class InvoiceCalculator
{
    private readonly decimal _taxRate = 0.2m;

    private readonly IInvoiceStore _store;

    public InvoiceCalculator(IInvoiceStore store)
    {
        _store = store;
    }

    public decimal Subtotal { get; private set; }

    /// <summary>Computes the rounded grand total for a subtotal.</summary>
    public decimal ComputeTotal(decimal subtotal)
    {
        // VIOLATION: code-quality/deterministic/local-could-be-const
        decimal roundingFactor = 100m;

        var tax = subtotal * _taxRate;
        return decimal.Round((subtotal + tax) * roundingFactor) / roundingFactor;
    }

    // VIOLATION: code-quality/deterministic/local-shadows-field
    public void Reset(decimal Subtotal)
    {
        this.Subtotal = Subtotal;
    }

    /// <summary>Returns the tax applied to a subtotal.</summary>
    public decimal AppliedTax(decimal subtotal)
    {
        // VIOLATION: code-quality/deterministic/prefer-immediate-return
        // VIOLATION: code-quality/deterministic/inline-single-use-local
        var tax = ComputeTax(subtotal);
        return tax;
    }

    /// <summary>Persists a computed invoice line.</summary>
    public void Persist(string invoiceId, decimal subtotal)
    {
        // VIOLATION: code-quality/deterministic/verbose-declaration-initialization
        InvoiceLine line = new InvoiceLine(invoiceId, ComputeTotal(subtotal));
        _store.Save(line);
    }

    // VIOLATION: code-quality/deterministic/redundant-async-await
    public async Task<decimal> ComputeTotalAsync(decimal subtotal)
    {
        return await _store.LoadAdjustmentAsync(subtotal);
    }

    private decimal ComputeTax(decimal subtotal) => subtotal * _taxRate;
}

internal sealed class InvoiceLine
{
    public InvoiceLine(string invoiceId, decimal total)
    {
        InvoiceId = invoiceId;
        Total = total;
    }

    public string InvoiceId { get; }

    public decimal Total { get; }
}

internal interface IInvoiceStore
{
    void Save(InvoiceLine line);

    Task<decimal> LoadAdjustmentAsync(decimal subtotal);
}
