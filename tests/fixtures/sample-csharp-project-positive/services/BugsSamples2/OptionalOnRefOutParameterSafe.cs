using System.Runtime.InteropServices;

namespace Positive.Boundary.Bugs;

/// <summary>Interop wrapper that marks a by-value parameter optional.</summary>
public sealed class OptionalOnRefOutParameterSafe
{
    /// <summary>Returns the text length, honoring an optional culture hint.</summary>
    // SAFE: bugs/deterministic/optional-on-ref-out-parameter
    public int Measure(string text, [Optional] string culture)
    {
        return text.Length + (culture ?? string.Empty).Length;
    }
}
