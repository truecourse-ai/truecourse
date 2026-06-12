namespace Reporting;

using Billing.Invoicing;
using Fmt = Billing.Common.Money;
using static Billing.Auditor;

public class ReportBuilder
{
    // Alias + using static + cross-project public type via ProjectReference
    public Fmt Summarize(Invoice invoice)
    {
        Record(invoice.Number);
        return invoice.Total;
    }
}

// RoundingPolicy is internal to Billing — referencing it from Reporting
// must NOT create an edge.
internal class LocalRounding
{
    public decimal Round(decimal value) => RoundingPolicy.Apply(value);
}

public class StatusReport
{
    // Fully qualified cross-project reference
    public Billing.Invoicing.InvoiceStatus Initial() => Billing.Invoicing.InvoiceStatus.Draft;
}
