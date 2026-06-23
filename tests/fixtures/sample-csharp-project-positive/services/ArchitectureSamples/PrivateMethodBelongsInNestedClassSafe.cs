using System;
using System.Collections.Generic;

namespace Positive.Boundary.Architecture;

/// <summary>Pages through a buffer; the decode helper is shared by the outer type too.</summary>
public sealed class PrivateMethodBelongsInNestedClassSafe
{
    private readonly IReadOnlyList<string> _rows;
    private readonly int _columnWidth;

    /// <summary>Creates a pager over the supplied rows.</summary>
    public PrivateMethodBelongsInNestedClassSafe(IReadOnlyList<string> rows, int columnWidth)
    {
        _rows = rows;
        _columnWidth = columnWidth;
    }

    // SAFE: architecture/deterministic/private-method-belongs-in-nested-class
    private string DecodeRow(string raw)
    {
        var trimmed = raw.Trim().ToUpperInvariant();
        return trimmed.Length > _columnWidth ? trimmed[.._columnWidth] : trimmed;
    }

    /// <summary>Decodes the first row directly from the outer type.</summary>
    public string FirstDecoded()
    {
        return _rows.Count > 0 ? DecodeRow(_rows[0]) : string.Empty;
    }

    private sealed class Cursor
    {
        private readonly PrivateMethodBelongsInNestedClassSafe _pager;

        internal Cursor(PrivateMethodBelongsInNestedClassSafe pager) => _pager = pager;

        internal string DecodeAt(int index)
        {
            return _pager.DecodeRow(_pager._rows[index]);
        }
    }

    /// <summary>Decodes a row through a cursor.</summary>
    public string DecodeVia(int index)
    {
        var cursor = new Cursor(this);
        return index >= 0 && index < _rows.Count ? cursor.DecodeAt(index) : string.Empty;
    }
}
