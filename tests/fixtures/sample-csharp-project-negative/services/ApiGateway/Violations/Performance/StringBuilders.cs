using System.Text;

namespace ApiGateway.Violations.Performance;

internal sealed class StringBuilders
{
    internal string Join(List<string> parts)
    {
        var sb = new StringBuilder();
        foreach (var part in parts)
        {
            // VIOLATION: performance/deterministic/stringbuilder-append-single-char-string
            sb = sb.Append(part).Append(";");
        }
        return sb.ToString();
    }

    internal string Describe(StringBuilder sb, int count)
    {
        // VIOLATION: performance/deterministic/stringbuilder-tostring-append
        return sb.Append(count.ToString()).ToString();
    }

    internal string Wrap(StringBuilder sb, string value)
    {
        // VIOLATION: performance/deterministic/redundant-stringbuilder-tostring
        return sb.Append(value + "\n").ToString();
    }
}
