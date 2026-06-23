using System.Data;
using System.Globalization;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A culture-sensitive <see cref="DataTable"/> created with its <c>Locale</c>
/// assigned in the object initializer. Because the culture is explicit, its
/// sorting and filtering behavior is deterministic and the rule must not fire.
/// </summary>
public sealed class LocaleNotSetSafe
{
    /// <summary>Creates an invariant-culture table for the given name.</summary>
    internal DataTable CreateTable(string tableName)
    {
        // SAFE: code-quality/deterministic/locale-not-set
        return new DataTable(tableName) { Locale = CultureInfo.InvariantCulture };
    }
}
