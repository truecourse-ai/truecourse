namespace Positive.Boundary.Bugs;

/// <summary>Formats two columns using a self-documenting tab escape, not a raw tab.</summary>
public sealed class LiteralControlCharacterSafe
{
    // SAFE: bugs/deterministic/literal-control-character
    private const string Separator = "\t";

    /// <summary>Joins the two columns with a tab.</summary>
    internal string Format(string left, string right) => left + Separator + right;
}
