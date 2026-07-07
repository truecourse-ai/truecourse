namespace UserService.Violations.CodeQuality;

// A builder exposing a public API whose default value is a versioning hazard.
public sealed class RetryOptionsBuilder
{
    // A public method with an optional value-type parameter whose default is
    // compiled into every call site — changing it later silently strands callers.
    // VIOLATION: code-quality/deterministic/optional-parameter-hazard
    public int Build(int maxAttempts = 3) => maxAttempts;
}
