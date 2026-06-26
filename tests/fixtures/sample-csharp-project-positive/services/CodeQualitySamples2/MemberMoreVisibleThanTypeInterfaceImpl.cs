namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Hosts private nested option types whose `public` members are mandated by an
/// interface contract. An implicit interface implementation MUST be public to
/// satisfy the contract, so the modifier is required — not a misleading widening
/// past the capped nested type — whether the interface is declared in-assembly
/// (resolvable) or comes from an external framework the analyzer cannot see.
/// </summary>
public sealed class MemberMoreVisibleThanTypeInterfaceImpl
{
    private interface IStageOption
    {
        int Priority { get; }
    }

    // Implements an in-assembly interface: the contract is resolvable.
    private sealed class LocalStageOption : IStageOption
    {
        // SAFE: code-quality/deterministic/member-more-visible-than-type
        public int Priority => 0;
    }

    // Implements an external framework interface the analyzer cannot resolve;
    // the public member is still contract-mandated and must not be flagged.
    private sealed class ExternalStageOption : StageFeatureBase, IConfigureStageFeature
    {
        // SAFE: code-quality/deterministic/member-more-visible-than-type
        public int Order { get; set; }
    }

    /// <summary>Returns the priority of the in-assembly stage option.</summary>
    internal int FirstPriority() => ((IStageOption)new LocalStageOption()).Priority;

    /// <summary>Builds the externally-typed stage option.</summary>
    internal object BuildExternal() => new ExternalStageOption();
}
