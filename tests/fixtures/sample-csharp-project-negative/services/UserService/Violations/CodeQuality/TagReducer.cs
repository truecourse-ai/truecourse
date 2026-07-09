using System.Collections.Generic;

namespace UserServiceApp.Violations.CodeQuality;

/// <summary>Folds batches of tags into a running count.</summary>
internal sealed class TagReducer
{
    private int _calls;

    // A genuinely awkward nested collection generic (IEnumerable&lt;List&lt;string&gt;&gt;)
    // that a named type would communicate far better — the rule should flag it.
    // VIOLATION: code-quality/deterministic/nested-generic-parameter
    internal int Merge(IEnumerable<List<string>> tagBatches)
    {
        _calls++;
        return _calls + (tagBatches != null ? 1 : 0);
    }
}
