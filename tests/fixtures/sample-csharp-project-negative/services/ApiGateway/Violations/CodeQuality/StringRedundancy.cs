namespace ApiGatewayApp.Violations.CodeQuality;

internal sealed class StringRedundancy
{
    internal string DefaultLabel()
    {
        // VIOLATION: code-quality/deterministic/prefer-string-empty
        return "";
    }

    internal string Describe(int code)
    {
        // VIOLATION: code-quality/deterministic/redundant-tostring-call
        // VIOLATION: bugs/deterministic/missing-format-provider-overload
        return "code-" + code.ToString();
    }

    internal string Tail(string value)
    {
        // VIOLATION: code-quality/deterministic/redundant-length-argument
        return value.Substring(2, value.Length - 2);
    }
}
