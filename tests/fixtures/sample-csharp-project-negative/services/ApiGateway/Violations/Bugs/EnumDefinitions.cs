namespace ApiGateway.Violations.Bugs;

// VIOLATION: code-quality/deterministic/enum-missing-zero-value
// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal enum DispatchStage
{
    Created = 1,
    Active = 2,
    // VIOLATION: bugs/deterministic/enum-duplicate-explicit-value
    Pending = 1,
}

// VIOLATION: bugs/deterministic/flags-enum-missing-zero
// VIOLATION: code-quality/deterministic/flags-enum-singular-name
[Flags]
internal enum RouteAccess
{
    Read = 1,
    Write = 2,
    Execute = 4,
}
