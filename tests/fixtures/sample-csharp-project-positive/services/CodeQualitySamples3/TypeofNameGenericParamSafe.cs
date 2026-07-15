using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// <c>typeof(T).Name</c> over a generic type parameter recovers the RUNTIME type
/// argument's name. <c>nameof(T)</c> would yield the literal "T" instead, so the
/// two are not equivalent and typeof-name-over-typeof-name must not fire.
/// </summary>
public sealed class TypeofNameGenericParamSafe
{
    /// <summary>Returns the runtime name of the supplied type argument.</summary>
    public string RuntimeTypeName<TValue>()
    {
        // SAFE: code-quality/deterministic/typeof-name-over-typeof-name
        return typeof(TValue).Name;
    }
}
