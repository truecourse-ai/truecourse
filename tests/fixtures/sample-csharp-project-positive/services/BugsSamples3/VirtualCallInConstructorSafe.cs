namespace Positive.Boundary.Bugs;

/// <summary>
/// A class that declares a virtual method but whose constructor invokes that
/// method on a *separate* collaborator rather than on the instance under
/// construction. Virtual dispatch on another object is fully initialized, so the
/// half-built-state hazard does not apply and the rule must not fire.
/// </summary>
public class VirtualCallInConstructorSafe
{
    private readonly string _name;

    /// <summary>Builds the formatter, delegating to an already-built helper.</summary>
    public VirtualCallInConstructorSafe(VirtualCallInConstructorSafe helper, string name)
    {
        // SAFE: bugs/deterministic/virtual-call-in-constructor
        _name = helper.Render();
        _name += name;
    }

    /// <summary>Renders the configured name; overridable by subclasses.</summary>
    public virtual string Render()
    {
        return _name;
    }
}
