namespace Positive.Boundary.Bugs;

/// <summary>Holds localized labels that contain ordinary non-ASCII letters.</summary>
public sealed class BidirectionalUnicodeSafe
{
    // SAFE: bugs/deterministic/bidirectional-unicode
    private const string Greeting = "Café déjà vu — Ångström";

    /// <summary>Returns the localized greeting label.</summary>
    internal string Label()
    {
        return Greeting;
    }
}
