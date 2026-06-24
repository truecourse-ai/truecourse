using System.Globalization;

namespace UserServiceApp.Violations.Performance;

/// <summary>
/// Parses fixed-width fields out of a flat record line. The numeric field is sliced
/// with Substring and parsed, allocating a throwaway string where AsSpan would parse
/// in place.
/// </summary>
internal sealed class FixedWidthParser
{
    private readonly int _offset;
    private readonly int _width;

    public FixedWidthParser(int offset, int width)
    {
        _offset = offset;
        _width = width;
    }

    /// <summary>Reads the quantity field from a fixed-width record line.</summary>
    public int ReadQuantity(string record)
    {
        // VIOLATION: performance/deterministic/prefer-asspan-over-substring
        return int.Parse(record.Substring(_offset, _width), CultureInfo.InvariantCulture);
    }
}
