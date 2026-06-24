using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A nested block that declares a local, which is the C# scoping idiom the
/// unnecessary-block check explicitly excludes. Only a bare block with no local
/// declarations is redundant, so this form must not fire.
/// </summary>
public class UnnecessaryBlockSafe
{
    /// <summary>Sorts the names, scoping a temporary snapshot inside a local block.</summary>
    public void Normalize(List<string> names)
    {
        // SAFE: code-quality/deterministic/unnecessary-block
        {
            var snapshot = new List<string>(names);
            snapshot.Sort();
            names.Clear();
            names.AddRange(snapshot);
        }
    }
}
