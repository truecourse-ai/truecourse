namespace Billing.Invoicing;

public class Invoice
{
    public string Number { get; set; } = null!;
    // Money is visible via the project's global using of Billing.Common
    public Money Total { get; set; }
    public InvoiceStatus Status { get; set; }
}

public enum InvoiceStatus { Draft, Sent, Paid }
