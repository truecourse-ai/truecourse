namespace UserServiceApp.Violations.CodeQuality;

internal class BaseFormatter
{
    internal virtual string Render(string input)
    {
        return input.Trim();
    }

    internal virtual string Join(string separator, params string[] parts)
    {
        return string.Join(separator, parts);
    }
}

internal sealed class PassthroughFormatter : BaseFormatter
{
    // VIOLATION: code-quality/deterministic/redundant-override
    internal override string Render(string input)
    {
        return base.Render(input);
    }

    // VIOLATION: code-quality/deterministic/params-not-on-override
    internal override string Join(string separator, string[] parts)
    {
        return string.Join(separator, parts) + "!";
    }
}
