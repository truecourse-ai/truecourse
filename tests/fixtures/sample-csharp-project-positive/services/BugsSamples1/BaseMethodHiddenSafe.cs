namespace Positive.Boundary.Bugs;

/// <summary>Base widget with a non-virtual render step.</summary>
public class BaseMethodHiddenSafeBase
{
    /// <summary>Renders the widget at its base level.</summary>
    public int Render(int width)
    {
        return width;
    }
}

/// <summary>Derived widget that intentionally hides the base render step.</summary>
public sealed class BaseMethodHiddenSafe : BaseMethodHiddenSafeBase
{
    /// <summary>Renders with the derived layout; hiding is declared with 'new'.</summary>
    // SAFE: bugs/deterministic/base-method-hidden
    public new int Render(int width)
    {
        return width + 1;
    }
}
