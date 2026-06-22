namespace ApiGateway.Violations.Style;

/// <summary>Feature toggles whose absence value is mis-named.</summary>
// VIOLATION: code-quality/deterministic/flags-enum-singular-name
[Flags]
internal enum FeatureToggle
{
    // VIOLATION: style/deterministic/flags-enum-zero-not-none
    Default = 0,
    Caching = 1,
    Tracing = 2,
}
