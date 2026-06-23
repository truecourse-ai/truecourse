using System;

namespace Positive.Boundary.Bugs;

/// <summary>Validates account balances before a transfer is queued.</summary>
public sealed class RaiseReservedExceptionTypeSafe
{
    /// <summary>Ensures the requested amount does not exceed the available balance.</summary>
    internal void EnsureSufficient(decimal balance, decimal amount)
    {
        if (amount > balance)
        {
            // SAFE: bugs/deterministic/raise-reserved-exception-type
            throw new InvalidOperationException("Transfer amount exceeds the available balance.");
        }
    }
}
