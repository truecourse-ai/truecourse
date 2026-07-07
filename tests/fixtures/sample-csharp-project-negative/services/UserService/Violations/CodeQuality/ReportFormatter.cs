namespace UserService.Violations.CodeQuality;

// A standalone formatter that owns its own signature (implements no interface).
public sealed class ReportFormatter
{
    // A public method with a parameter that is never read — a genuine unused
    // parameter, not fixed by any interface contract.
    // VIOLATION: code-quality/deterministic/unused-function-parameter
    public int Format(string text, int unusedWidth) => text.Length;
}
