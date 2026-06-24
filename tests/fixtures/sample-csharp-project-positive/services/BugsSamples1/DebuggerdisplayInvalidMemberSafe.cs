using System.Diagnostics;

namespace Positive.Boundary.Bugs;

/// <summary>Surfaces a real property in its debugger display string.</summary>
// SAFE: bugs/deterministic/debuggerdisplay-invalid-member
[DebuggerDisplay("{Endpoint}")]
public sealed class DebuggerdisplayInvalidMemberSafe
{
    /// <summary>The endpoint shown in the debugger.</summary>
    internal string Endpoint { get; }

    /// <summary>Creates a record for the given endpoint.</summary>
    internal DebuggerdisplayInvalidMemberSafe(string endpoint)
    {
        Endpoint = endpoint;
    }
}
