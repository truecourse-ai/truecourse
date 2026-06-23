namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A base class whose <c>virtual</c> hook has an empty body on purpose, so
/// derived classes can override it selectively. The empty-function rule
/// excludes virtual hooks and must not fire.
/// </summary>
public class EmptyFunctionSafe
{
    /// <summary>Override to react after a record is saved; the default is a no-op.</summary>
    // SAFE: code-quality/deterministic/empty-function
    protected virtual void OnSaved(int recordId)
    {
    }

    /// <summary>Invokes the post-save hook for the given record.</summary>
    internal void Save(int recordId)
    {
        OnSaved(recordId);
    }
}
