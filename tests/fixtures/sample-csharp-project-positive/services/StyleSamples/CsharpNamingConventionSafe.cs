namespace Positive.Boundary.Style;

internal sealed class CsharpNamingConventionSafe
{
    // SAFE: style/deterministic/csharp-naming-convention
    private int _retryCount;

    internal int RecordRetry() => ++_retryCount;
}
