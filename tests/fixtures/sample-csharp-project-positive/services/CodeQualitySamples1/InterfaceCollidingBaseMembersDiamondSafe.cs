namespace Positive.Boundary.CodeQuality;

/// <summary>Base contract exposing a single operation.</summary>
public interface IReportBase
{
    /// <summary>Runs the report.</summary>
    void Run();
}

/// <summary>Left branch of a diamond — inherits the base contract unchanged.</summary>
public interface IReportLeftBranch : IReportBase { }

/// <summary>Right branch of a diamond — inherits the base contract unchanged.</summary>
public interface IReportRightBranch : IReportBase { }

/// <summary>
/// Diamond inheritance: <c>Run</c> reaches this interface through two branches, but both
/// expose the SAME original declaration on <see cref="IReportBase"/> (one declaring type).
/// That is not a genuine collision, so interface-colliding-base-members must not fire.
/// </summary>
// SAFE: code-quality/deterministic/interface-colliding-base-members
public interface IDiamondReport : IReportLeftBranch, IReportRightBranch { }

/// <summary>Query contract with two overloads that share a name but not a signature.</summary>
public interface IQuerySource
{
    /// <summary>Fetches by id.</summary>
    void Fetch(int id);

    /// <summary>Fetches by id with a filter.</summary>
    void Fetch(int id, string filter);
}

/// <summary>Metadata contract with an unrelated member.</summary>
public interface IMetadataSource
{
    /// <summary>Describes the source.</summary>
    void Describe();
}

/// <summary>
/// Overloads with distinct parameter-type signatures are independent members, each with a
/// single origin — not an ambiguous name collision — so the rule must not fire here either.
/// </summary>
// SAFE: code-quality/deterministic/interface-colliding-base-members
public interface ICompositeSource : IQuerySource, IMetadataSource { }

/// <summary>Consumes the diamond and composite contracts through their derived interfaces.</summary>
public sealed class InterfaceCollidingBaseMembersDiamondSafe
{
    private readonly IDiamondReport _report;

    /// <summary>Wraps a report reached through a diamond interface.</summary>
    public InterfaceCollidingBaseMembersDiamondSafe(IDiamondReport report)
    {
        _report = report;
    }

    /// <summary>Runs the wrapped report; <c>Run</c> resolves unambiguously despite the diamond.</summary>
    public void Execute()
    {
        _report.Run();
    }
}
