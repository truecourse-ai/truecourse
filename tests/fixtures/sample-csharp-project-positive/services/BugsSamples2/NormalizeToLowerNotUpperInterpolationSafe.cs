namespace Positive.Boundary.Bugs;

/// <summary>
/// Lowercases a value ONLY to embed it in display/markup output (a CSS class name) via a
/// string-interpolation hole. This is a presentation context, not storage/comparison
/// normalization, and switching to <c>ToUpperInvariant</c> would produce the wrong markup,
/// so normalize-to-lower-not-upper must not fire on a <c>ToLower</c> that sits directly
/// inside an interpolation hole.
/// </summary>
public sealed class NormalizeToLowerNotUpperInterpolationSafe
{
    /// <summary>Builds a CSS class name for the given status label.</summary>
    public string StatusCssClass(string status)
    {
        // SAFE: bugs/deterministic/normalize-to-lower-not-upper
        return $"badge-{status.ToLower()}";
    }
}
