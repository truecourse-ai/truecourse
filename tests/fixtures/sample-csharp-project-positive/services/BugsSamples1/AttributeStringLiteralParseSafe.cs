using System.Runtime.InteropServices;

namespace Positive.Boundary.Bugs;

/// <summary>A COM-visible component whose GUID literal parses correctly.</summary>
// SAFE: bugs/deterministic/attribute-string-literal-parse
[Guid("d3b07384-d113-4ec4-9f5a-1b2c3d4e5f6a")]
[ComVisible(true)]
public sealed class AttributeStringLiteralParseSafe
{
    private int _exportCount;

    /// <summary>Number of exports performed so far.</summary>
    internal int ExportCount => _exportCount;

    /// <summary>Exports the current snapshot.</summary>
    internal void Export()
    {
        _exportCount++;
    }
}
