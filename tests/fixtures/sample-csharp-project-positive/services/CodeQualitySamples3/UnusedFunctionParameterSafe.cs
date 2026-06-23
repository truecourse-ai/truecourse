using System.Threading;

namespace Positive.Boundary.CodeQuality;

/// <summary>Accepts a convention-bound token alongside a parameter it reads.</summary>
public sealed class UnusedFunctionParameterSafe
{
    /// <summary>Returns the trimmed name; the cancellation token is part of the fixed signature.</summary>
    // SAFE: code-quality/deterministic/unused-function-parameter
    internal string Normalize(string name, CancellationToken cancellationToken)
    {
        return name.Trim();
    }
}
