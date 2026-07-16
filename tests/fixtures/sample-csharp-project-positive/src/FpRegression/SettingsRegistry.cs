using System.Collections.Generic;

namespace Demo.Serialization;

/// <summary>
/// Assembles default lookups in a static constructor that also runs a loop, so
/// the constructor cannot be removed. Inlining any single field here yields no
/// beforefieldinit benefit (the loop keeps the cctor alive), so none of these
/// static fields must be flagged as "initialize inline".
/// </summary>
internal static class SettingsRegistry
{
    private static readonly string[] KnownKeys = { "alpha", "beta", "gamma" };

    private static readonly Dictionary<string, int> Ranks;

    static SettingsRegistry()
    {
        Ranks = new Dictionary<string, int>();

        var order = 0;
        foreach (var key in KnownKeys)
        {
            Ranks[key] = order;
            order++;
        }
    }

    /// <summary>Returns the assembled rank for <paramref name="key"/>, or -1 when unknown.</summary>
    public static int RankOf(string key) => Ranks.TryGetValue(key, out var rank) ? rank : -1;
}
