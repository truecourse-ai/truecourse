namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Exposes a single parameterless <c>GetChecksum()</c> that recomputes a value
/// on each call. Because there is no matching <c>SetChecksum</c>, the method is
/// not half of a get/set pair, so the prefer-property rule correctly leaves the
/// standalone computed getter alone.
/// </summary>
public sealed class PreferPropertyOverMethodSafe
{
    private readonly byte[] _data;

    /// <summary>Creates an instance over the supplied bytes.</summary>
    public PreferPropertyOverMethodSafe(byte[] data) => _data = data;

    /// <summary>Computes a checksum over the underlying bytes.</summary>
    // SAFE: code-quality/deterministic/prefer-property-over-method
    public int GetChecksum()
    {
        int sum = 0;
        foreach (byte b in _data)
        {
            sum += b;
        }

        return sum;
    }
}
