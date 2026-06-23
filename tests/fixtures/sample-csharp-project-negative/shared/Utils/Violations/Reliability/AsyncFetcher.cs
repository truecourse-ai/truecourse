using System;
using System.Net.Http;
using System.Threading.Tasks;

namespace Utils.Violations.Reliability;

/// <summary>
/// Fetches and forwards small payloads on behalf of callers. As shared library code it
/// must not capture the caller's synchronization context: a desktop or classic-ASP.NET
/// caller that blocks on these tasks would deadlock. The awaits below omit
/// ConfigureAwait(false).
/// </summary>
public sealed class AsyncFetcher
{
    private readonly HttpClient _http;

    public AsyncFetcher(HttpClient http)
    {
        _http = http;
    }

    /// <summary>Reads a resource and returns its body length.</summary>
    public async Task<int> LengthOfAsync(Uri resource)
    {
        // VIOLATION: reliability/deterministic/missing-configureawait
        var body = await _http.GetStringAsync(resource);
        return body.Length;
    }

    /// <summary>Reads two resources in sequence and returns the combined length.</summary>
    public async Task<int> CombinedLengthAsync(Uri first, Uri second)
    {
        // VIOLATION: reliability/deterministic/missing-configureawait
        var a = await _http.GetStringAsync(first);
        // Correctly configured — must not fire.
        var b = await _http.GetStringAsync(second).ConfigureAwait(false);
        return a.Length + b.Length;
    }
}
