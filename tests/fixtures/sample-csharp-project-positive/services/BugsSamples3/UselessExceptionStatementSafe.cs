using System;

namespace Positive.Boundary.Bugs;

/// <summary>Validates that a connection name is present before it is used.</summary>
public sealed class UselessExceptionStatementSafe
{
    /// <summary>Throws when the connection name is missing.</summary>
    internal void ValidateName(string name)
    {
        if (string.IsNullOrEmpty(name))
        {
            // SAFE: bugs/deterministic/useless-exception-statement
            throw new InvalidOperationException("connection name is required");
        }
    }
}
