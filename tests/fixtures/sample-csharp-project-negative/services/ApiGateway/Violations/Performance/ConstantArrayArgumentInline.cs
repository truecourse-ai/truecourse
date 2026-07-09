using System;

namespace ApiGateway.Violations.Performance;

internal sealed class ConstantArrayArgumentInline
{
    internal bool IsReservedHeader(string header)
    {
        // VIOLATION: performance/deterministic/constant-array-argument
        return Array.IndexOf(new[] { "Host", "Accept", "Cookie" }, header) >= 0;
    }
}
