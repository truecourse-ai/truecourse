using System;

namespace Positive.Boundary.Bugs;

/// <summary>
/// A constructor that calls one of its own methods. Because the class is sealed, no
/// derived override can run before initialization, so the virtual-dispatch hazard
/// cannot arise and the rule must not fire.
/// </summary>
public sealed class ConstructorCallsVirtualMethodSafe
{
    private string _label;

    /// <summary>Builds the instance and runs initialization.</summary>
    public ConstructorCallsVirtualMethodSafe(string label)
    {
        _label = label;
        // SAFE: bugs/deterministic/constructor-calls-virtual-method
        Initialize();
    }

    /// <summary>The configured label.</summary>
    public string Label => _label;

    private void Initialize()
    {
        _label = _label.Trim();
    }
}
