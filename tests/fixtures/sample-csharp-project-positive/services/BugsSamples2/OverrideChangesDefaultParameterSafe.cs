namespace Positive.Boundary.Bugs;

/// <summary>Base formatter exposing an optional indent width.</summary>
internal class OverrideChangesDefaultParameterSafeBase
{
    /// <summary>Formats text at the requested indent.</summary>
    public virtual int Format(string text, int indent = 2)
    {
        return text.Length + indent;
    }
}

/// <summary>Override that preserves the base's default for the optional parameter.</summary>
internal sealed class OverrideChangesDefaultParameterSafe : OverrideChangesDefaultParameterSafeBase
{
    /// <summary>Formats with the same default indent as the base.</summary>
    // SAFE: bugs/deterministic/override-changes-default-parameter
    public override int Format(string text, int indent = 2)
    {
        return text.Length + indent + 1;
    }
}
