using System.Collections.Generic;

namespace ApiGateway.Violations.Architecture;

/// <summary>
/// Pages through a flat result buffer. The row-decoding helper lives on the outer pager
/// but is only ever called from the nested page cursor, so the cursor's logic is split
/// across two scopes for no reason.
/// </summary>
public sealed class ResultPager
{
    private readonly IReadOnlyList<string> _rows;
    private readonly int _columnWidth;
    private readonly int _pageSize;

    /// <summary>Creates a pager over <paramref name="rows"/>.</summary>
    public ResultPager(IReadOnlyList<string> rows, int columnWidth, int pageSize)
    {
        _rows = rows;
        _columnWidth = columnWidth;
        _pageSize = pageSize;
    }

    // VIOLATION: architecture/deterministic/private-method-belongs-in-nested-class
    private string DecodeRow(string raw)
    {
        var trimmed = raw.Trim().ToUpperInvariant();
        return trimmed.Length > _columnWidth ? trimmed[.._columnWidth] : trimmed;
    }

    /// <summary>Reads every page in order and flattens the decoded rows.</summary>
    public IEnumerable<string> ReadAll()
    {
        var cursor = new Cursor(this);
        for (var page = cursor.NextPage(); page.Count > 0; page = cursor.NextPage())
            foreach (var row in page)
                yield return row;
    }

    private sealed class Cursor
    {
        private readonly ResultPager _pager;
        private int _offset;

        internal Cursor(ResultPager pager) => _pager = pager;

        internal IReadOnlyList<string> NextPage()
        {
            var end = System.Math.Min(_offset + _pager._pageSize, _pager._rows.Count);
            var page = new List<string>();
            for (var i = _offset; i < end; i++)
                page.Add(_pager.DecodeRow(_pager._rows[i]));
            _offset = end;
            return page;
        }
    }
}
