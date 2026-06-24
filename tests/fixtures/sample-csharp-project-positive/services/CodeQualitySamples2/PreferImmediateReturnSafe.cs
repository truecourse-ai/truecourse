namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Reads a disposable reader and returns a value from it. The local is declared
/// with <c>using</c>, so the scope disposes it before control leaves the method;
/// folding the declaration into the return would change semantics, so the
/// declare-then-return rule deliberately leaves the <c>using var</c> form alone.
/// </summary>
public sealed class PreferImmediateReturnSafe
{
    internal int FirstByte(byte[] payload)
    {
        // SAFE: code-quality/deterministic/prefer-immediate-return
        using var stream = new System.IO.MemoryStream(payload);
        return stream.ReadByte();
    }
}
