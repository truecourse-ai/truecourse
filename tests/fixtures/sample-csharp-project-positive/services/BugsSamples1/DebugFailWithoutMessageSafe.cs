using System.Diagnostics;

namespace Positive.Boundary.Bugs;

/// <summary>Fails an unreachable switch branch with a descriptive message.</summary>
public sealed class DebugFailWithoutMessageSafe
{
    /// <summary>Maps a known state code; unreachable codes fail loudly.</summary>
    internal string Describe(int state)
    {
        if (state == 0)
        {
            return "idle";
        }

        // SAFE: bugs/deterministic/debug-fail-without-message
        Debug.Fail("unexpected state code reached");
        return "unknown";
    }
}
