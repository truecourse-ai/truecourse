using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A string is normalized with ToLower/ToLowerInvariant. Lowercasing for normalization
/// has a documented round-trip data-loss problem (the Turkish dotless-I), so the
/// guidance is to normalize with ToUpperInvariant instead. CA1308.
///
/// We require the receiver to resolve to System.String so user-defined methods named
/// ToLower on other types are not flagged. One narrow exemption: ToLower/ToLowerInvariant
/// embedded as an interpolation hole inside a string literal ($"prefix-{s.ToLower()}")
/// is display-only output (CSS class names, HTML attributes) where the case-fold is
/// intentional and switching to ToUpperInvariant would produce wrong output.
/// </summary>
internal sealed class NormalizeToLowerNotUpper : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/normalize-to-lower-not-upper";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.ContainingType?.SpecialType != SpecialType.System_String) continue;
            if (m.Name is not ("ToLower" or "ToLowerInvariant")) continue;

            // Exempt: the lowercased value is directly embedded inside a string
            // interpolation hole — a display/markup context (CSS class, HTML attribute)
            // where the lowercase is intentional and ToUpperInvariant would be wrong.
            if (inv.Parent is InterpolationSyntax) continue;

            var pos = TargetLocation(inv).GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"string.{m.Name} for normalization can lose data on round-trip (the Turkish-I problem) — normalize with ToUpperInvariant instead.");
        }
    }

    private static Location TargetLocation(InvocationExpressionSyntax inv) =>
        inv.Expression is MemberAccessExpressionSyntax ma ? ma.Name.GetLocation() : inv.GetLocation();
}
