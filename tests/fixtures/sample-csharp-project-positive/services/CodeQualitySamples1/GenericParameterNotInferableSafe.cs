using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A generic method whose type parameter appears in a value parameter type, so the
/// compiler can infer it at the call site. The rule only flags parameters absent from
/// every parameter type, so this stays clean.
/// </summary>
public sealed class GenericParameterNotInferableSafe
{
    /// <summary>Wraps a single value in a list; T is inferred from the argument.</summary>
    // SAFE: code-quality/deterministic/generic-parameter-not-inferable
    internal List<T> Wrap<T>(T value)
    {
        return new List<T> { value };
    }
}
