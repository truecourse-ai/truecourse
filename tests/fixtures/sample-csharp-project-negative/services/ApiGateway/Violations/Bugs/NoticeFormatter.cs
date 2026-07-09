namespace ApiGatewayApp.Violations.Bugs;

internal sealed class NoticeFormatter
{
    internal string Build()
    {
        // VIOLATION: bugs/deterministic/fstring-missing-placeholders
        return $"no placeholders here";
    }
}
