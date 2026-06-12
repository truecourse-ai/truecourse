// In-memory fixed-window rate limiter used as a single-instance backstop.
// The production gateway enforces the real limit; this guards a single process.
namespace SampleApi.Services;

public class RateLimit
{
    // Per-client request ceiling. Chosen to match the upstream gateway's burst
    // allowance, but it lives only in code — no spec, ADR, or runbook records it.
    public const int RateLimitPerMinute = 100;

    private readonly Dictionary<string, (int Count, double ResetAt)> _hits = new();

    public bool Allow(string clientId)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var (count, resetAt) = _hits.TryGetValue(clientId, out var hit) ? hit : (0, 0.0);

        if (resetAt < now)
        {
            _hits[clientId] = (1, now + 60.0);
            return true;
        }

        if (count >= RateLimitPerMinute)
        {
            return false;
        }

        _hits[clientId] = (count + 1, resetAt);
        return true;
    }
}
