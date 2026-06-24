using System.Collections.ObjectModel;

namespace Positive.Boundary.CodeQuality;

/// <summary>Ordered batch of order ids built on the recommended Collection base.</summary>
// SAFE: code-quality/deterministic/subclass-builtin-collection
public sealed class SubclassBuiltinCollectionSafe : Collection<string>
{
    /// <summary>Append an order id only when it is not already present.</summary>
    public void AddUnique(string orderId)
    {
        if (!Contains(orderId))
        {
            Add(orderId);
        }
    }
}
