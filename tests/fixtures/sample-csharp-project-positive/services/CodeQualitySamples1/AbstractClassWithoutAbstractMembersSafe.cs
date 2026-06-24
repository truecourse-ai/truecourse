namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An abstract class that declares a genuine abstract member, so it has a real
/// contractual reason to be abstract and the rule must not fire.
/// </summary>
public abstract class AbstractClassWithoutAbstractMembersSafe
{
    /// <summary>The section title shared by all subclasses.</summary>
    protected string Title { get; }

    /// <summary>Initializes the shared title state for subclasses.</summary>
    protected AbstractClassWithoutAbstractMembersSafe(string title)
    {
        Title = title;
    }

    /// <summary>Renders the section body; subclasses must implement it.</summary>
    // SAFE: code-quality/deterministic/abstract-class-without-abstract-members
    protected abstract string Render();
}
