using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Looks up prices with a single dictionary probe.</summary>
public sealed class PreferTryGetValueSafe
{
    /// <summary>Reads the value in one lookup via TryGetValue instead of ContainsKey plus indexer.</summary>
    public decimal PriceFor(Dictionary<string, decimal> prices, string sku)
    {
        // SAFE: performance/deterministic/prefer-trygetvalue
        if (prices.TryGetValue(sku, out var price))
        {
            return price;
        }
        return 0m;
    }
}
