using NUnit.Framework;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A test fixture with mutable static state that is reset by a static
/// lifecycle hook before each test. The test reads the shared field but does
/// not mutate it, so the test-modifying-global-state rule must not fire.
/// </summary>
public class TestModifyingGlobalStateSafe
{
    private static int _callCount;

    /// <summary>Resets shared static state before each test runs.</summary>
    [SetUp]
    public static void ResetState()
    {
        _callCount = 0;
    }

    /// <summary>Verifies the shared counter starts from a clean baseline.</summary>
    // SAFE: code-quality/deterministic/test-modifying-global-state
    [Test]
    public void Counter_StartsAtZero()
    {
        Assert.AreEqual(0, _callCount);
    }
}
