namespace ApiGateway.Violations.Style;

/// <summary>Request scope flags with a non-PascalCase member name.</summary>
// VIOLATION: code-quality/deterministic/flags-enum-singular-name
[Flags]
// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal enum ScopeAccess
{
    None = 0,
    // VIOLATION: style/deterministic/enum-naming-convention
    read_only = 1,
    Write = 2,
}
