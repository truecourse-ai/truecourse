namespace ApiGatewayApp.Violations.CodeQuality;

internal sealed class RedundantSyntax
{
    internal int Adjust(int value)
    {
        // VIOLATION: code-quality/deterministic/unnecessary-unary-plus
        return +value;
    }

    internal string Label()
    {
        // VIOLATION: code-quality/deterministic/unnecessary-verbatim-string
        return @"gateway";
    }
}
