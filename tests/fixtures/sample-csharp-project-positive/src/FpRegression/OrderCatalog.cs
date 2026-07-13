namespace Demo.Sample;

/// <summary>Groups related order lookup names under one owning type.</summary>
public static class OrderCatalog
{
    /// <summary>Order lifecycle status names.</summary>
    internal static class Statuses
    {
        internal const string Pending = "pending";
    }

    /// <summary>Sales channel names.</summary>
    internal static class Channels
    {
        internal const string Web = "web";
    }

    /// <summary>Region names.</summary>
    internal static class Regions
    {
        internal const string North = "north";
    }

    /// <summary>Fulfilment kind names.</summary>
    internal static class Kinds
    {
        internal const string Retail = "retail";
    }
}
