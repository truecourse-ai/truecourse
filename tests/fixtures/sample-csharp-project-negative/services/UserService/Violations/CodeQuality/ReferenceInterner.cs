using System.Collections.Generic;

namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// Canonicalizes equal reference values so duplicates share one instance. The public
/// surface predates generics: it takes and returns object, so every caller has to cast
/// the interned value back to the type it passed in, losing compile-time type safety.
/// </summary>
public sealed class ReferenceInterner
{
    private readonly Dictionary<object, object> _canonical = new();

    /// <summary>Returns the shared instance equal to <paramref name="value"/>.</summary>
    // VIOLATION: code-quality/deterministic/prefer-generics-over-object
    public object Intern(object value)
    {
        if (_canonical.TryGetValue(value, out var existing))
        {
            return existing;
        }

        _canonical[value] = value;
        return value;
    }
}
