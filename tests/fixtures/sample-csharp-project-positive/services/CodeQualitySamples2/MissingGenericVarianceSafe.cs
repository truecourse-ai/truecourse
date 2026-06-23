namespace Positive.Boundary.CodeQuality;

/// <summary>
/// The type parameter appears in both an input position (the Store parameter)
/// and an output position (the Load return), so it cannot be made covariant and
/// missing-generic-variance must not fire.
/// </summary>
public interface IMissingGenericVarianceSafeStore<T>
{
    /// <summary>Loads the stored value for an id.</summary>
    T Load(string id);

    // SAFE: code-quality/deterministic/missing-generic-variance
    /// <summary>Stores a value under an id.</summary>
    void Store(string id, T value);
}

/// <summary>Concrete anchor type matching the file name.</summary>
public class MissingGenericVarianceSafe
{
    /// <summary>Returns whether the given id is well-formed.</summary>
    public bool IsValidId(string id)
    {
        return id.Length > 0;
    }
}
