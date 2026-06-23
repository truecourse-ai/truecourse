using Xunit;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An equality assertion whose expected and actual arguments are distinct
/// expressions, so the test-same-argument rule must not fire.
/// </summary>
public class TestSameArgumentSafe
{
    /// <summary>Verifies the doubled value matches the expected constant.</summary>
    // SAFE: code-quality/deterministic/test-same-argument
    [Fact]
    public void Double_MatchesExpected()
    {
        var expected = 4;
        var actual = 2 + 2;
        Assert.Equal(expected, actual);
    }
}
