namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Performs the same one-time warmup work, but as an ordinary method the consumer
/// calls explicitly rather than a [ModuleInitializer] — so no hidden assembly-load
/// side effect runs, and moduleinitializer-in-library must not fire.
/// </summary>
public static class ModuleInitializerInLibrarySafe
{
    // SAFE: code-quality/deterministic/moduleinitializer-in-library
    /// <summary>Warms the given switch when the consumer opts in.</summary>
    public static void Warm(string switchName)
    {
        System.AppContext.SetSwitch(switchName, true);
    }
}
