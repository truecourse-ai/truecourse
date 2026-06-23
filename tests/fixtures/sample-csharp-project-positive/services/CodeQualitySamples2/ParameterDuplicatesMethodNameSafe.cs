namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A method whose parameter is named for the value it carries (<c>value</c>),
/// not for the enclosing method (<c>Record</c>). The names differ, so the
/// copy-paste check must not fire.
/// </summary>
public sealed class ParameterDuplicatesMethodNameSafe
{
    private int _last;

    /// <summary>Records the supplied value as the most recent entry.</summary>
    // SAFE: code-quality/deterministic/parameter-duplicates-method-name
    internal void Record(int value)
    {
        _last = value;
    }

    /// <summary>Returns the most recently recorded value.</summary>
    internal int Last() => _last;
}
