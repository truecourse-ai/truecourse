using System;

namespace Positive.Boundary.Performance;

/// <summary>Hex-encodes a digest using the direct converter, with no dash-stripping chain.</summary>
public sealed class UseToHexStringSafe
{
    /// <summary>Returns the hex representation of the digest bytes.</summary>
    internal string Fingerprint(byte[] digest)
    {
        // SAFE: performance/deterministic/use-tohexstring
        return Convert.ToHexString(digest);
    }
}
