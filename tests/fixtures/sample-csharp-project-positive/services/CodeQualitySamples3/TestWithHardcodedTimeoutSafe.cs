using System.Threading;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A production retry helper that sleeps between attempts. Because the sleep
/// lives in a non-test method (not an xUnit/NUnit/MSTest method), the
/// test-with-hardcoded-timeout rule must not fire.
/// </summary>
public class TestWithHardcodedTimeoutSafe
{
    /// <summary>Pauses the given delay before the caller retries.</summary>
    // SAFE: code-quality/deterministic/test-with-hardcoded-timeout
    internal void BackOff(int delayMs)
    {
        Thread.Sleep(delayMs);
    }
}
