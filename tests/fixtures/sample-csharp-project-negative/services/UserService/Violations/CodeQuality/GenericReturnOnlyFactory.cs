namespace UserServiceApp.Violations.CodeQuality;

internal static class GenericReturnOnlyFactory
{
    // The type parameter appears only in the return type — it is used by no
    // parameter at all, so callers must always spell it out (`Build<Ledger>()`).
    // VIOLATION: code-quality/deterministic/generic-parameter-not-inferable
    internal static T Build<T>() where T : new()
    {
        return new T();
    }
}
