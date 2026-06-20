namespace ApiGateway.Violations.Bugs;

// VIOLATION: code-quality/deterministic/enum-missing-zero-value
internal enum DispatchStage
{
    Created = 1,
    Active = 2,
    // VIOLATION: bugs/deterministic/enum-duplicate-explicit-value
    Pending = 1,
}

// VIOLATION: bugs/deterministic/flags-enum-missing-zero
[Flags]
internal enum RouteAccess
{
    Read = 1,
    Write = 2,
    Execute = 4,
}
