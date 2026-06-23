namespace Positive.Boundary.Bugs;

/// <summary>Base widget exposing a default rendered label.</summary>
public class WidgetBase
{
    /// <summary>Produces the label shown for this widget.</summary>
    public virtual string Render()
    {
        return "widget";
    }
}

/// <summary>A labelled widget that augments the base label with its own prefix.</summary>
public sealed class RedundantBaseCallSafe : WidgetBase
{
    /// <summary>Renders the prefixed label, delegating to the overridden base.</summary>
    public override string Render()
    {
        // SAFE: bugs/deterministic/redundant-base-call
        return "labelled:" + base.Render();
    }
}
