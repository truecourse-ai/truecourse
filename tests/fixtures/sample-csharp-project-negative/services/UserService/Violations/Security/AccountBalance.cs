using System;
using System.Runtime.Serialization;

namespace UserServiceApp.Violations.Security;

/// <summary>
/// A serializable account balance. The public constructor rejects a negative balance,
/// but the deserialization constructor copies the field straight out of the serialized
/// payload with no such check — so a tampered stream can resurrect a balance the normal
/// constructor would have refused.
/// </summary>
[Serializable]
internal sealed class AccountBalance : ISerializable
{
    private readonly decimal _amount;

    public AccountBalance(decimal amount)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(amount);
        _amount = amount;
    }

    // VIOLATION: security/deterministic/serializable-without-validation
    private AccountBalance(SerializationInfo info, StreamingContext context)
    {
        _ = context;
        _amount = info.GetDecimal(nameof(_amount));
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
