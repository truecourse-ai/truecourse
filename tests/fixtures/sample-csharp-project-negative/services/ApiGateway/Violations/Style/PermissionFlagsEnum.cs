namespace ApiGateway.Violations.Style;

/// <summary>Gateway permission bits with a redundant type-name suffix.</summary>
[Flags]
// VIOLATION: style/deterministic/enum-name-redundant-suffix
// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal enum PermissionFlags
{
    None = 0,
    Read = 1,
    Write = 2,
    Admin = 4,
}
