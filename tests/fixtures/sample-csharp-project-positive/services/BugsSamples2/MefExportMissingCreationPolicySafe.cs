using System.ComponentModel.Composition;

namespace Positive.Boundary.Bugs;

/// <summary>A MEF part whose lifetime is made explicit via a creation policy.</summary>
// SAFE: bugs/deterministic/mef-export-missing-creation-policy
[Export]
[PartCreationPolicy(CreationPolicy.Shared)]
public sealed class MefExportMissingCreationPolicySafe
{
    /// <summary>Returns a stable greeting for the composed part.</summary>
    public string Describe() => "shared part";
}
