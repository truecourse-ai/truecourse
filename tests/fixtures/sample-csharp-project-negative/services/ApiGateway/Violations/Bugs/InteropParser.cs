using System.Runtime.InteropServices;

namespace ApiGateway.Violations.Bugs;

internal sealed class InteropParser
{
    // VIOLATION: bugs/deterministic/optional-on-ref-out-parameter
    internal void TryParse(string text, [Optional] out int value)
    {
        value = text.Length;
    }
}
