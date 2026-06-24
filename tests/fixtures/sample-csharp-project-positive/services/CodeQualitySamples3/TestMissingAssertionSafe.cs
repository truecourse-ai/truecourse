using Xunit;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A test method that exercises behaviour and contains a real assertion, so
/// the test-missing-assertion rule must not fire.
/// </summary>
public class TestMissingAssertionSafe
{
    /// <summary>Verifies addition produces the expected sum.</summary>
    // SAFE: code-quality/deterministic/test-missing-assertion
    [Fact]
    public void Sum_ReturnsExpectedTotal()
    {
        var total = 1 + 1;
        Assert.Equal(2, total);
    }
}
