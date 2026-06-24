using Xunit;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A parameterized test that declares parameters supplied by a data-source attribute
/// ([Theory] with [InlineData]), so the runner can drive it. Parameters are legitimate
/// here, so invalid-test-method-signature must not fire.
/// </summary>
public sealed class InvalidTestMethodSignatureSafe
{
    /// <summary>A non-negative amount is accepted by the charge guard.</summary>
    // SAFE: code-quality/deterministic/invalid-test-method-signature
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    public void Charges_the_card(decimal amount)
    {
        Assert.True(amount >= 0m);
    }
}
