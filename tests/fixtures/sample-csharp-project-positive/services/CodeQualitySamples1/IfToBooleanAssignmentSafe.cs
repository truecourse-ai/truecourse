namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An if/else that assigns the same field in both arms but with computed
/// (non-boolean-literal) values, so it cannot collapse to <c>x = condition;</c>
/// and the if-to-boolean-assignment rule must not fire.
/// </summary>
public class IfToBooleanAssignmentSafe
{
    private string _state = "idle";

    private int _seen;

    /// <summary>Records the depth and assigns a non-boolean state in each arm.</summary>
    public string Classify(int depth)
    {
        // SAFE: code-quality/deterministic/if-to-boolean-assignment
        if (depth > 0)
        {
            _seen += depth;
            _state = "ready";
        }
        else
        {
            _state = "waiting";
        }

        return _state;
    }
}
