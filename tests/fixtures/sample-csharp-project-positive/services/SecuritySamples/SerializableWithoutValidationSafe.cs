using System;
using System.Runtime.Serialization;

namespace Positive.Boundary.Security;

/// <summary>
/// A serializable account balance whose deserialization constructor re-applies the same
/// guard its public constructor enforces, so a tampered payload cannot bypass the invariant.
/// </summary>
[Serializable]
public sealed class SerializableWithoutValidationSafe : ISerializable
{
    private readonly decimal _amount;

    /// <summary>Creates a balance, rejecting a negative amount.</summary>
    public SerializableWithoutValidationSafe(decimal amount)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(amount);
        _amount = amount;
    }

    // SAFE: security/deterministic/serializable-without-validation
    private SerializableWithoutValidationSafe(SerializationInfo info, StreamingContext context)
    {
        _ = context;
        decimal amount = info.GetDecimal(nameof(_amount));
        ArgumentOutOfRangeException.ThrowIfNegative(amount);
        _amount = amount;
    }

    /// <summary>The validated balance amount.</summary>
    public decimal Amount => _amount;

    /// <summary>Writes the balance into the serialization stream.</summary>
    public void GetObjectData(SerializationInfo info, StreamingContext context)
    {
        _ = context;
        info.AddValue(nameof(_amount), _amount);
    }
}
