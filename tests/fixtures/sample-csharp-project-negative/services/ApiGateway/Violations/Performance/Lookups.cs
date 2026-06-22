using System.Collections.Generic;

namespace ApiGateway.Violations.Performance;

internal sealed class Lookups
{
    internal decimal PriceFor(Dictionary<string, decimal> prices, string sku)
    {
        // VIOLATION: performance/deterministic/prefer-trygetvalue
        if (prices.ContainsKey(sku))
        {
            return prices[sku];
        }
        return 0m;
    }
}
