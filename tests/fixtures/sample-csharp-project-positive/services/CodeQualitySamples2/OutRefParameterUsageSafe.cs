namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A public method that exposes an <c>out</c> parameter under the sanctioned
/// <c>Try</c> idiom, the one shape for which <c>out</c> is the established
/// convention, so the rule must not fire.
/// </summary>
public class OutRefParameterUsageSafe
{
    // SAFE: code-quality/deterministic/out-ref-parameter-usage
    public bool TryGetLength(string text, out int length)
    {
        length = text.Length;
        return length > 0;
    }
}
