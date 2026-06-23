using Xunit;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An active test declared with a bare <c>[Fact]</c> and no <c>Skip</c>
/// argument or <c>[Ignore]</c>, so the test-skipped rule must not fire.
/// </summary>
public class TestSkippedSafe
{
    /// <summary>Verifies the increment produces the expected result.</summary>
    // SAFE: code-quality/deterministic/test-skipped
    [Fact]
    public void Increment_ReturnsNextValue()
    {
        var result = 1 + 1;
        Assert.Equal(2, result);
    }
}
