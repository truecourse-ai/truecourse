using System.Collections.Generic;

namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// Read-side repository contracts for the user service. The interfaces here were
/// composed by inheritance without attention to variance or member collisions.
/// </summary>

// VIOLATION: code-quality/deterministic/missing-generic-variance
// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal interface IUserReader<T>
{
    T Load(string id);

    IReadOnlyList<T> LoadAll();
}

internal interface IAuditable
{
    string Describe();
}

internal interface ITrackable
{
    string Describe();
}

// VIOLATION: code-quality/deterministic/interface-colliding-base-members
internal interface IUserRecord : IAuditable, ITrackable
{
    string Id { get; }
}
