namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A component-style abstract base whose `virtual` lifecycle hook is a real
/// extension point — legitimately abstract, so
/// abstract-class-without-abstract-members must not fire.
/// </summary>
public abstract class AbstractBaseWithExtensionSignalSafe
{
    /// <summary>Overridable initialization hook for subclasses.</summary>
    // SAFE: code-quality/deterministic/abstract-class-without-abstract-members
    protected virtual void OnInitialized()
    {
    }
}

/// <summary>
/// An abstract base that implements an interface, providing shared behaviour for
/// the contract — a legitimate reason to be abstract, so the rule does not fire.
/// </summary>
public abstract class WorkerBaseSafe : IWorkerSafe
{
    /// <summary>Shared start behaviour for all workers.</summary>
    // SAFE: code-quality/deterministic/abstract-class-without-abstract-members
    public void Start()
    {
        Started = true;
    }

    /// <summary>Whether the worker has started.</summary>
    public bool Started { get; private set; }
}

/// <summary>A worker contract implemented by the abstract base above.</summary>
public interface IWorkerSafe
{
    /// <summary>Starts the worker.</summary>
    void Start();
}
