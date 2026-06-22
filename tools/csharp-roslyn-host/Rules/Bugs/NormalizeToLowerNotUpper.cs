using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A string is normalized with ToLower/ToLowerInvariant. Lowercasing for normalization has
/// a documented round-trip data-loss problem (the Turkish dotless-I), so the guidance is to
/// normalize with ToUpperInvariant instead. We require the receiver to resolve to
/// System.String (so this is a real string op, not some user method named ToLower) — hence
/// the semantic model. CA1308.
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

            var pos = TargetLocation(inv).GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"string.{m.Name} for normalization can lose data on round-trip (the Turkish-I problem) — normalize with ToUpperInvariant instead.");
        }
    }

    private static Location TargetLocation(InvocationExpressionSyntax inv) =>
        inv.Expression is MemberAccessExpressionSyntax ma ? ma.Name.GetLocation() : inv.GetLocation();
}
