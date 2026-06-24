using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An if/else whose two arms run genuinely different side effects, so the bodies
/// are not identical and the if-with-same-arms rule must not fire.
/// </summary>
public class IfWithSameArmsSafe
{
    private readonly List<string> _log = new();

    /// <summary>Records a different label in each branch.</summary>
    public void Record(bool ready)
    {
        // SAFE: code-quality/deterministic/if-with-same-arms
        if (ready)
        {
            _log.Add("ready");
        }
        else
        {
            _log.Add("waiting");
        }
    }

    /// <summary>The recorded labels.</summary>
    public IReadOnlyList<string> Log => _log;
}
