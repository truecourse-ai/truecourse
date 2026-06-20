namespace UserServiceApp.Violations.CodeQuality;

internal class BaseFormatter
{
    internal virtual string Render(string input)
    {
        return input.Trim();
    }
}

internal sealed class PassthroughFormatter : BaseFormatter
{
    // VIOLATION: code-quality/deterministic/redundant-override
    internal override string Render(string input)
    {
        return base.Render(input);
    }
}
