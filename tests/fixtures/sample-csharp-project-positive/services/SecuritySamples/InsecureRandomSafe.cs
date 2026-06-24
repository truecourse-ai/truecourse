using System;

namespace Positive.Boundary.Security;

/// <summary>Uses System.Random only for retry jitter, never for security values.</summary>
public sealed class InsecureRandomSafe
{
    private const int MinJitterMs = 50;
    private const int MaxJitterMs = 150;

    /// <summary>Returns a randomized backoff delay in milliseconds for the given attempt.</summary>
    internal int BackoffDelay(int attempt)
    {
        // SAFE: security/deterministic/insecure-random
        var jitter = new Random();
        return attempt * jitter.Next(MinJitterMs, MaxJitterMs);
    }
}
