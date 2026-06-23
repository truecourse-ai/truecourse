using Xunit;

namespace ApiGateway.Violations.CodeQuality;

public sealed class CheckoutTests
{
    /// <summary>The charge call should reach the gateway.</summary>
    // VIOLATION: code-quality/deterministic/invalid-test-method-signature
    [Fact]
    public void Charges_the_card(decimal amount)
    {
        Assert.True(amount >= 0m);
    }
}
