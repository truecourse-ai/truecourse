using System;

namespace Positive.Boundary.Bugs;

/// <summary>Parses a flag and catches the precise format failure, not NREs.</summary>
public sealed class CatchNullReferenceExceptionSafe
{
    /// <summary>Parses the text as a boolean, returning false on a bad format.</summary>
    internal bool ParseFlagOrFalse(string value)
    {
        try
        {
            return bool.Parse(value);
        }
        // SAFE: bugs/deterministic/catch-null-reference-exception
        catch (FormatException)
        {
            return false;
        }
    }
}
