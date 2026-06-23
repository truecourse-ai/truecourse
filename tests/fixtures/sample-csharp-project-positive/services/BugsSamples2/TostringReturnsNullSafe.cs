namespace Positive.Boundary.Bugs;

/// <summary>A coordinate label whose ToString never returns null.</summary>
public sealed class TostringReturnsNullSafe
{
    private readonly string _value;

    /// <summary>Creates the label from the given value.</summary>
    public TostringReturnsNullSafe(string value) => _value = value;

    /// <summary>Returns the label text, or an empty string when none is set.</summary>
    public override string ToString()
    {
        // SAFE: bugs/deterministic/tostring-returns-null
        return _value ?? string.Empty;
    }
}
