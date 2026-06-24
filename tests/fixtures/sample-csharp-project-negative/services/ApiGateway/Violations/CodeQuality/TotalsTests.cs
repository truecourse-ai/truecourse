using FluentAssertions;
using Xunit;

namespace ApiGateway.Violations.CodeQuality;

public sealed class TotalsTests
{
    /// <summary>The running total should stay positive after a credit.</summary>
    [Fact]
    public void Total_stays_positive()
    {
        var total = Credit(10, 3);

        // VIOLATION: code-quality/deterministic/incomplete-assertion
        total.Should();
    }

    private static int Credit(int balance, int amount) => balance + amount;
}
