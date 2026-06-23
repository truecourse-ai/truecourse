namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Consumes a facet that multiply-inherits two bases declaring the same member name
/// but REDECLARES that member itself, which disambiguates access through the derived
/// interface, so interface-colliding-base-members must not fire.
/// </summary>
public sealed class InterfaceCollidingBaseMembersSafe
{
    private readonly IUserRecordFacet _facet;

    /// <summary>Wraps a facet whose Describe is unambiguous.</summary>
    public InterfaceCollidingBaseMembersSafe(IUserRecordFacet facet)
    {
        _facet = facet;
    }

    /// <summary>Describes the wrapped record via the disambiguated facet.</summary>
    public string Describe()
    {
        return _facet.Describe();
    }
}

/// <summary>Audit facet exposing a description.</summary>
public interface IAuditableFacet
{
    /// <summary>Describes the audit state.</summary>
    string Describe();
}

/// <summary>Tracking facet exposing a description.</summary>
public interface ITrackableFacet
{
    /// <summary>Describes the tracking state.</summary>
    string Describe();
}

/// <summary>
/// Combines both facets but redeclares Describe, so the name is unambiguous through this
/// interface.
/// </summary>
// SAFE: code-quality/deterministic/interface-colliding-base-members
public interface IUserRecordFacet : IAuditableFacet, ITrackableFacet
{
    /// <summary>Describes the combined record, resolving the inherited collision.</summary>
    new string Describe();
}
