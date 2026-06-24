namespace Positive.Boundary.Bugs;

/// <summary>Holds derived pool sizing where each field reads only earlier ones.</summary>
internal static class StaticFieldInitializationOrderSafe
{
    /// <summary>Maximum connections in the pool.</summary>
    internal const int MaxConnections = 64;

    // SAFE: bugs/deterministic/static-field-initialization-order
    internal static readonly int PoolSize = MaxConnections + 1;
}
