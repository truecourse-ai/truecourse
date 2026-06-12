namespace Billing.Invoicing;

public class InvoiceCalculator
{
    // Invoice resolves with no using directive — same namespace, other file.
    // Auditor resolves through the ancestor namespace (Billing).
    public Money TotalOf(Invoice invoice)
    {
        Auditor.Record(invoice.Number);
        return invoice.Total;
    }
}
