namespace Positive.Boundary.Bugs;

/// <summary>Holds a display label built from ordinary, visible spaces.</summary>
public sealed class InvisibleWhitespaceSafe
{
    // SAFE: bugs/deterministic/invisible-whitespace
    private const string Label = "First Last";

    /// <summary>Returns the label with a trailing marker separated by a regular space.</summary>
    internal string Decorate(string marker) => $"{Label} {marker}";
}
