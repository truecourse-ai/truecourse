using Xunit;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Asserts a runtime condition rather than a constant. The unconditional-assertion
/// check only fires when the first argument is a boolean literal; a value computed
/// from the code under test is the correct form and must not fire.
/// </summary>
public class UnconditionalAssertionSafe
{
    /// <summary>Asserts that a positive balance is reported as funded.</summary>
    [Fact]
    public void Funded_WhenBalancePositive()
    {
        var funded = IsFunded(100);
        // SAFE: code-quality/deterministic/unconditional-assertion
        Assert.True(funded);
    }

    private static bool IsFunded(int balance)
    {
        return balance > 0;
    }
}
