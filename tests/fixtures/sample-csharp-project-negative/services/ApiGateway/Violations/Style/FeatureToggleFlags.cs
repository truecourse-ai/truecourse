namespace ApiGateway.Violations.Style;

/// <summary>Feature toggles whose absence value is mis-named.</summary>
[Flags]
internal enum FeatureToggle
{
    // VIOLATION: style/deterministic/flags-enum-zero-not-none
    Default = 0,
    Caching = 1,
    Tracing = 2,
}
