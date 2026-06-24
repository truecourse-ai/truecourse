using System.Runtime.InteropServices;

namespace UserServiceApp.Violations.Bugs;

/// <summary>
/// A COM-visible contract for legacy interop. The explicit GUID was hand-edited and
/// lost a character, so it no longer parses as a valid GUID.
/// </summary>
// VIOLATION: bugs/deterministic/attribute-string-literal-parse
[Guid("d3b07384-d113-4ec4-9f5a-1b2c3d4e5f6")]
[ComVisible(true)]
internal interface ILegacyExporter
{
    /// <summary>Exports the current snapshot.</summary>
    void Export();
}
