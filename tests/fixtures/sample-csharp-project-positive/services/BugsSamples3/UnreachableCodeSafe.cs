namespace Positive.Boundary.Bugs;

/// <summary>Formats a label using a local helper declared after the return statement.</summary>
public sealed class UnreachableCodeSafe
{
    /// <summary>A local function after a return is a declaration, not unreachable code.</summary>
    internal string FormatLabel(string prefix, int version)
    {
        // SAFE: bugs/deterministic/unreachable-code
        return prefix + Suffix();

        string Suffix()
        {
            return "-v" + version;
        }
    }
}
