using Microsoft.JSInterop;

namespace ApiGateway.Violations.Bugs;

/// <summary>
/// A small JS-interop bridge for clipboard paste events. The callback JavaScript invokes
/// is declared internal, so DotNet.invokeMethod cannot reach it — the paste handler binds
/// in JavaScript but throws the moment it fires.
/// </summary>
internal sealed class ClipboardInterop
{
    /// <summary>The most recent pasted text.</summary>
    public string Buffer { get; private set; } = string.Empty;

    // VIOLATION: bugs/deterministic/jsinvokable-non-public
    [JSInvokable]
    internal void OnPaste(string text)
    {
        Buffer = text;
    }
}
