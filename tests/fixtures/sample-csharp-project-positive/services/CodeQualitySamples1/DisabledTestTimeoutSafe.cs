using Xunit;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A test whose timeout is a small, reasonable value (well under the
/// 60000ms threshold and non-zero), so the disabled-test-timeout rule must
/// not fire.
/// </summary>
public class DisabledTestTimeoutSafe
{
    /// <summary>Verifies the calculator settles under a sane timeout.</summary>
    // SAFE: code-quality/deterministic/disabled-test-timeout
    [Fact(Timeout = 5000)]
    public void Settles_WithinReasonableTimeout()
    {
        var result = 1 + 1;
        Assert.Equal(2, result);
    }
}
