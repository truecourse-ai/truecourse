namespace Positive.Boundary.Bugs;

/// <summary>
/// Builds a projection of the current instance. Inside the object initializer,
/// <c>Name = Name</c> sets the <em>new</em> object's member from the enclosing
/// instance's property (an implicit <c>this.Name</c>); it copies a value across
/// two distinct objects and is not a self-assignment.
/// </summary>
public sealed class SelfAssignmentInitializerSafe
{
    /// <summary>The display name carried by this instance.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Creates a projection copying the name from this instance.</summary>
    public NameProjectionSafe ToProjection()
    {
        // SAFE: bugs/deterministic/self-assignment
        return new NameProjectionSafe { Name = Name };
    }
}

/// <summary>A projection target that mirrors the source's name.</summary>
public sealed class NameProjectionSafe
{
    /// <summary>The projected name.</summary>
    public string Name { get; set; } = string.Empty;
}
