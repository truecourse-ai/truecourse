namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Concatenates a string literal with a <c>ToString</c> call that takes a
/// format argument, so the conversion is not the redundant parameterless form.
/// The redundant-ToString rule must not fire on a formatted conversion.
/// </summary>
public class RedundantTostringCallSafe
{
    /// <summary>Renders <paramref name="id"/> as a dash-free label.</summary>
    public string Describe(System.Guid id)
    {
        // SAFE: code-quality/deterministic/redundant-tostring-call
        return "id-" + id.ToString("N");
    }
}
