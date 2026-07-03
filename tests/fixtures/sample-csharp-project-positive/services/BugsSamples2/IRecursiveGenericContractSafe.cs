namespace Positive.Boundary.Bugs;

/// <summary>
/// The non-generic contract base.
/// </summary>
public interface IRecursiveGenericContractSafe
{
    /// <summary>Sends a request with no payload.</summary>
    void Send();
}

/// <summary>
/// The strongly-typed contract. It extends the non-generic, same-named base
/// interface — a distinct type of <em>lower generic arity</em>. This
/// generic-extends-non-generic pairing is idiomatic, not the self-referential
/// recursive inheritance the rule targets.
/// </summary>
/// <typeparam name="TPayload">The payload type carried by the typed contract.</typeparam>
// SAFE: bugs/deterministic/recursive-type-inheritance
public interface IRecursiveGenericContractSafe<TPayload> : IRecursiveGenericContractSafe
{
    /// <summary>Sends a typed payload.</summary>
    /// <param name="payload">The payload to send.</param>
    void Send(TPayload payload);
}
