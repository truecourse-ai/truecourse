using System;

namespace Positive.Boundary.Bugs;

/// <summary>Validates a quantity with a paramName literal that matches the parameter.</summary>
public sealed class ArgumentexceptionWrongParameterNameSafe
{
    /// <summary>Throws when the quantity is negative.</summary>
    public void EnsureQuantity(int quantity)
    {
        if (quantity < 0)
        {
            // SAFE: bugs/deterministic/argumentexception-wrong-parameter-name
            throw new ArgumentException("quantity must be non-negative", nameof(quantity));
        }
    }
}
