using System.Diagnostics.Contracts;

namespace ApiGateway.Violations.Bugs;

internal sealed class HashComputer
{
    [Pure]
    // VIOLATION: bugs/deterministic/pure-method-returns-void
    internal void Combine(string left, string right)
    {
        _ = left.Length + right.Length;
    }
}
