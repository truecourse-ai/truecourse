using System;

namespace Positive.Boundary.Bugs;

/// <summary>Self-test that asserts a specific exception type rather than the base Exception.</summary>
public sealed class AssertRaisesTooBroadSafe
{
    private int _selfTestRuns;

    /// <summary>Runs the parse self-test, expecting a precise ArgumentException.</summary>
    public void RunSelfTest()
    {
        // SAFE: bugs/deterministic/assert-raises-too-broad
        Assert.Throws(typeof(ArgumentException), () => ParseTarget(string.Empty));
        _selfTestRuns++;
    }

    private static string ParseTarget(string target)
    {
        if (target.Length == 0)
        {
            throw new ArgumentException("target is required", nameof(target));
        }
        return target;
    }
}
