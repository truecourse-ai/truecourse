using FluentAssertions;
using Xunit;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A FluentAssertions <c>.Should()</c> call that chains a real constraint, so the
/// assertion is complete and the incomplete-assertion rule must not fire.
/// </summary>
public sealed class IncompleteAssertionSafe
{
    /// <summary>Verifies the credited total exceeds the starting balance.</summary>
    [Fact]
    public void Total_exceeds_balance()
    {
        var total = Credit(10, 3);

        // SAFE: code-quality/deterministic/incomplete-assertion
        total.Should().BeGreaterThan(10);
    }

    private static int Credit(int balance, int amount) => balance + amount;
}
