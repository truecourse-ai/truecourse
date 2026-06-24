using System.Net;
using System.Net.Sockets;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A string literal that is a routable IPv4/IPv6 address. Hardcoding addresses
/// couples the code to one environment and can leak internal topology; the value
/// belongs in configuration. Resolved through the semantic model only to confirm
/// the literal is a string (not, say, an interpolation fragment), but the decision
/// is the parsed address itself. Loopback, link-local, unspecified, multicast,
/// documentation and other non-routable ranges are excluded to stay false-positive
/// free — those are never an environment-coupling concern.
/// </summary>
internal sealed class HardcodedIpAddress : ISemanticRule
{
    public string RuleKey => "security/deterministic/hardcoded-ip-address";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var lit in tree.GetRoot().DescendantNodes().OfType<LiteralExpressionSyntax>())
        {
            if (!lit.IsKind(SyntaxKind.StringLiteralExpression)) continue;
            if (lit.Token.Value is not string raw) continue;

            var value = raw.Trim();
            if (!LooksLikeRoutableIp(value)) continue;

            var pos = lit.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Hardcoded IP address '{value}' — move it to configuration to avoid coupling the code to one environment.");
        }
    }

    /// <summary>
    /// True only for a literal that parses cleanly as a single routable address.
    /// Everything ambiguous (version strings like "1.2.3", masks, non-routable
    /// ranges) is rejected so the rule never fires on a non-address.
    /// </summary>
    private static bool LooksLikeRoutableIp(string value)
    {
        // Reject obvious non-addresses early: an IPv4 must be exactly four
        // dot-separated octets; IPAddress.Parse is otherwise lax (it accepts
        // "1.2", shorthand, leading zeros) and would create false positives.
        if (value.Contains('.') && !value.Contains(':'))
        {
            var parts = value.Split('.');
            if (parts.Length != 4) return false;
            foreach (var part in parts)
            {
                if (part.Length == 0 || part.Length > 3) return false;
                foreach (var c in part) if (c is < '0' or > '9') return false;
                if (!int.TryParse(part, out var octet) || octet > 255) return false;
            }
        }

        if (!IPAddress.TryParse(value, out var ip)) return false;

        // Only treat full IPv6 forms (containing ':') or strict IPv4 as addresses;
        // a bare integer or short form is too easily a non-address.
        if (ip.AddressFamily == AddressFamily.InterNetwork && !value.Contains('.')) return false;
        if (ip.AddressFamily == AddressFamily.InterNetworkV6 && !value.Contains(':')) return false;

        return IsRoutable(ip);
    }

    private static bool IsRoutable(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip)) return false;
        if (ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any)) return false;
        if (ip.Equals(IPAddress.Broadcast)) return false;

        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            // 0.0.0.0/8 (unspecified/this-network)
            if (b[0] == 0) return false;
            // 169.254.0.0/16 link-local
            if (b[0] == 169 && b[1] == 254) return false;
            // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved
            if (b[0] >= 224) return false;
            // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 documentation (RFC 5737)
            if (b[0] == 192 && b[1] == 0 && b[2] == 2) return false;
            if (b[0] == 198 && b[1] == 51 && b[2] == 100) return false;
            if (b[0] == 203 && b[1] == 0 && b[2] == 113) return false;
            return true;
        }

        // IPv6
        if (ip.IsIPv6LinkLocal || ip.IsIPv6Multicast || ip.IsIPv6SiteLocal) return false;
        var v6 = ip.GetAddressBytes();
        // 2001:db8::/32 documentation
        if (v6[0] == 0x20 && v6[1] == 0x01 && v6[2] == 0x0d && v6[3] == 0xb8) return false;
        return true;
    }
}
