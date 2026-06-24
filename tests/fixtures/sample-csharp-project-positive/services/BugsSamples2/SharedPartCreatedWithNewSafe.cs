using System.ComponentModel.Composition;

namespace Positive.Boundary.Bugs;

/// <summary>A non-shared MEF part: a fresh instance per import is the intended contract.</summary>
[Export]
[PartCreationPolicy(CreationPolicy.NonShared)]
public sealed class SharedPartCreatedWithNewSafe
{
    /// <summary>Number of lookups served by this instance.</summary>
    public int Lookups { get; set; }

    /// <summary>Constructs a fresh part directly, which is valid for a non-shared part.</summary>
    internal static SharedPartCreatedWithNewSafe Create()
    {
        // SAFE: bugs/deterministic/shared-part-created-with-new
        return new SharedPartCreatedWithNewSafe();
    }
}
