using Microsoft.JSInterop;

namespace Positive.Boundary.Bugs;

/// <summary>A JS-interop bridge whose callback is public so DotNet.invokeMethod can reach it.</summary>
public sealed class JsInvokableNonPublicSafe
{
    /// <summary>The most recent pasted text.</summary>
    public string Buffer { get; private set; } = string.Empty;

    // SAFE: bugs/deterministic/jsinvokable-non-public
    /// <summary>Records text pasted from JavaScript.</summary>
    [JSInvokable]
    public void OnPaste(string text)
    {
        Buffer = text;
    }
}
