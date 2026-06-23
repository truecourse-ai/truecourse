using System;
using System.Collections.Generic;

namespace Positive.Boundary.Style;

/// <summary>Wires a transform using an escaped reserved lambda parameter.</summary>
internal sealed class ScopedIdentifierEscapeSafe
{
    private readonly List<Func<int, int>> _stages = new();

    internal void Add()
    {
        // SAFE: style/deterministic/scoped-identifier-escape
        _stages.Add((@scoped) => @scoped + 1);
    }
}
