using System.Collections.Generic;

namespace UserServiceApp.Violations.Performance;

/// <summary>
/// Enriches a user profile with derived fields. The per-request scratch state is
/// held in a private nested helper that is never subclassed, so it could be sealed
/// to make intent clear and let the JIT devirtualize its calls.
/// </summary>
internal sealed class ProfileEnricher
{
    private readonly Dictionary<int, string> _avatarUrls;

    internal ProfileEnricher(Dictionary<int, string> avatarUrls)
    {
        _avatarUrls = avatarUrls;
    }

    internal string Enrich(int userId, string displayName)
    {
        var scratch = new EnrichmentScratch(displayName);
        if (_avatarUrls.TryGetValue(userId, out var url))
        {
            scratch.AttachAvatar(url);
        }
        return scratch.Render();
    }

    // VIOLATION: performance/deterministic/non-derived-private-class-not-sealed
    private class EnrichmentScratch
    {
        private readonly string _displayName;
        private string? _avatarUrl;

        internal EnrichmentScratch(string displayName) => _displayName = displayName;

        internal void AttachAvatar(string url) => _avatarUrl = url;

        internal string Render() => _avatarUrl is null ? _displayName : $"{_displayName} <{_avatarUrl}>";
    }
}
