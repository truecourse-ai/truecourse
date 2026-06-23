using System;

namespace ApiGateway.Violations.Bugs;

// Holds process- and thread-level startup constants. Two defects: a static field
// initialized from a later static field (which is still zero at that point), and a
// [ThreadStatic] field given an inline initializer (which only runs on the first
// thread, leaving every other thread's copy at default).
internal static class StartupConfig
{
    // Reads MaxConnections before it is initialized — evaluates to 0 + 1.
    // VIOLATION: bugs/deterministic/static-field-initialization-order
    // VIOLATION: bugs/deterministic/non-constant-static-field-visible
    // VIOLATION: code-quality/deterministic/non-private-field
    // VIOLATION: architecture/deterministic/declarations-in-global-scope
    internal static int PoolSize = MaxConnections + 1;

    // VIOLATION: bugs/deterministic/non-constant-static-field-visible
    // VIOLATION: code-quality/deterministic/non-private-field
    // VIOLATION: architecture/deterministic/declarations-in-global-scope
    internal static int MaxConnections = 64;

    // The inline initializer runs once, on the first thread to touch the type; other
    // threads observe 0.
    // VIOLATION: bugs/deterministic/threadstatic-initialized-inline
    // VIOLATION: bugs/deterministic/threadstatic-inline-initialization
    [ThreadStatic]
    // VIOLATION: bugs/deterministic/threadstatic-initialized-inline
    private static int _retryCounter = 3;

    internal static int NextRetry() => ++_retryCounter;
}
