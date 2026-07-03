namespace Positive.Boundary.Bugs;

/// <summary>
/// Case-folds a value ONLY to embed it in display/markup output (a CSS class name) via a
/// string-interpolation hole. This is a presentation context, not storage/comparison
/// normalization, so normalize-to-lower-not-upper must not fire on a case-fold that sits
/// directly inside an interpolation hole. <c>ToLowerInvariant</c> is used so the fold is
/// culture-independent (no culture-unaware-string-operation concern).
/// </summary>
public sealed class NormalizeToLowerNotUpperInterpolationSafe
{
    /// <summary>Builds a CSS class name for the given status label.</summary>
    public string StatusCssClass(string status)
    {
        // SAFE: bugs/deterministic/normalize-to-lower-not-upper
        return $"badge-{status.ToLowerInvariant()}";
    }
}
