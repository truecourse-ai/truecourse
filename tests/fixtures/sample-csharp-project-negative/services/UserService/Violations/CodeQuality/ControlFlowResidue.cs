namespace UserServiceApp.Violations.CodeQuality;

using System.Diagnostics;

internal class ControlFlowResidue
{
    internal void Apply(bool ready, System.Collections.Generic.List<string> log)
    {
        if (ready)
        {
            log.Add("ready");
        }
        // VIOLATION: code-quality/deterministic/empty-else-clause
        else
        {
        }
    }

    internal void Guard(string state)
    {
        if (state == "open" || state == "closed" || state == "pending")
        {
            return;
        }
        // VIOLATION: code-quality/deterministic/debug-assert-false
        Debug.Assert(false, "unhandled state");
    }
}
