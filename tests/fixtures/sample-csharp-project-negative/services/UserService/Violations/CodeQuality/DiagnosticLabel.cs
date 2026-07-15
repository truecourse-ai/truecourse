namespace UserServiceApp.Violations.CodeQuality;

internal class DiagnosticLabel
{
    // VIOLATION: code-quality/deterministic/typeof-name-over-typeof-name
    internal string Label => typeof(DiagnosticLabel).Name;
}
