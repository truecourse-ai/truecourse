using System.Threading.Tasks;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A parameter typed with a single-level generic (<c>Task&lt;int&gt;</c>) whose
/// type argument is a plain named type, so it sits just under the
/// nested-generic threshold and the rule must not fire.
/// </summary>
public class NestedGenericParameterSafe
{
    /// <summary>Awaits the supplied work and returns one more than its result.</summary>
    // SAFE: code-quality/deterministic/nested-generic-parameter
    public async Task<int> NextAsync(Task<int> pending)
    {
        var current = await pending;
        return current + 1;
    }
}
