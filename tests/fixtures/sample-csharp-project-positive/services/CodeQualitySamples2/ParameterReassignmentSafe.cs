using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A method that keeps its parameter immutable by copying it into a local and
/// rounding the local instead of the parameter. The parameter is never assigned,
/// so the reassignment check must not fire.
/// </summary>
public sealed class ParameterReassignmentSafe
{
    /// <summary>Returns the amount rounded to two decimal places.</summary>
    // SAFE: code-quality/deterministic/parameter-reassignment
    internal decimal NormalizeAmount(decimal amount)
    {
        var rounded = Math.Round(amount, 2);
        if (rounded < 0m)
        {
            rounded = 0m;
        }

        return rounded;
    }
}
