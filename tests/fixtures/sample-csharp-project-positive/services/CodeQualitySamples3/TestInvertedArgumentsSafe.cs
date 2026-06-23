using Xunit;

namespace Positive.Boundary.CodeQuality;

/// <summary>Assertion with the literal in the expected slot, as the frameworks require.</summary>
public sealed class TestInvertedArgumentsSafe
{
    [Fact]
    public void Subtotal_MatchesLedgerRate()
    {
        var calculator = new LedgerCalculator();
        // SAFE: code-quality/deterministic/test-inverted-arguments
        Assert.Equal(19.5m, calculator.Subtotal(120m, 2));
    }
}

internal sealed class LedgerCalculator
{
    private const decimal MonthsPerYear = 12m;
    private const decimal RoundingOffset = 0.5m;

    internal decimal Subtotal(decimal amount, int rate)
    {
        var monthly = amount / rate / MonthsPerYear;
        return monthly + RoundingOffset;
    }
}
