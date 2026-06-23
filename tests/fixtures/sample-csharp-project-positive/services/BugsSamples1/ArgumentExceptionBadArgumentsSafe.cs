using System;

namespace Positive.Boundary.Bugs;

/// <summary>Validates a page size using a correctly-ordered ArgumentException.</summary>
public sealed class ArgumentExceptionBadArgumentsSafe
{
    /// <summary>Throws when the page size is not positive.</summary>
    public void ValidatePageSize(int count)
    {
        if (count <= 0)
        {
            // SAFE: bugs/deterministic/argument-exception-bad-arguments
            throw new ArgumentException("page size must be positive", nameof(count));
        }
    }
}
