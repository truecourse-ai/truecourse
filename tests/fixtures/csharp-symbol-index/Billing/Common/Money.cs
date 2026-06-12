namespace Billing.Common;

public readonly struct Money
{
    public decimal Amount { get; init; }
    public string Currency { get; init; }
}

internal class RoundingPolicy
{
    public static decimal Apply(decimal value) => Math.Round(value, 2);
}
