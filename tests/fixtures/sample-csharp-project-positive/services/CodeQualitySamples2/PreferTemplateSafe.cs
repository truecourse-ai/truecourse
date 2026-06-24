namespace Positive.Boundary.CodeQuality;

/// <summary>Builds a label by appending a single value to a prefix.</summary>
public sealed class PreferTemplateSafe
{
    /// <summary>Returns the order id prefixed with a fixed label.</summary>
    internal string Label(string orderId)
    {
        // SAFE: code-quality/deterministic/prefer-template
        return "Order " + orderId;
    }
}
