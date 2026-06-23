namespace Positive.Boundary.Bugs;

/// <summary>Base resource handle.</summary>
public class Resource
{
    /// <summary>Identifier of the resource.</summary>
    public int Id { get; set; }
}

/// <summary>A cached resource handle.</summary>
public sealed class CachedResource : Resource
{
    /// <summary>Whether the cached copy is still warm.</summary>
    public bool IsWarm { get; set; }
}

/// <summary>Builds a resource pool using an invariant array type.</summary>
public sealed class ArrayCovarianceSafe
{
    private const int PoolSize = 4;

    /// <summary>Returns a pool typed as its exact element type, so no covariant store can fail.</summary>
    public CachedResource[] BuildPool()
    {
        // SAFE: bugs/deterministic/array-covariance
        return new CachedResource[PoolSize];
    }
}
