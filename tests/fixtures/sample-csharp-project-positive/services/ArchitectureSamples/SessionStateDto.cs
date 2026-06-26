namespace Positive.Boundary.Architecture;

/// <summary>
/// A response/output DTO describing a session's lifetime. It is built server-side
/// through its constructor and serialized to clients — never model-bound from a
/// request — so its non-nullable value-type members cannot under-post. The
/// under-posting rule must not flag a type that is constructed in code.
/// </summary>
public sealed class SessionStateDto
{
    /// <summary>The opaque session identifier.</summary>
    public string SessionId { get; set; } = string.Empty;

    // SAFE: architecture/deterministic/value-type-action-param-under-posting
    /// <summary>Seconds until the session expires; set server-side, not bound.</summary>
    public int ExpiresInSeconds { get; set; }

    /// <summary>Builds the response from server-computed values.</summary>
    public SessionStateDto(string sessionId, int expiresInSeconds)
    {
        SessionId = sessionId;
        ExpiresInSeconds = expiresInSeconds;
    }
}
