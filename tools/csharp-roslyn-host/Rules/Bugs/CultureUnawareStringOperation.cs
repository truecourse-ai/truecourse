using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A `string` instance method whose result depends on the current culture is called
/// without an explicit culture/comparison argument: ToLower()/ToUpper() (parameterless),
/// or string.Compare without a StringComparison/CultureInfo. These give locale-dependent,
/// non-portable results. We require the receiver/target to resolve to System.String and
/// the culture-bearing overload to actually be the one being called (no comparison arg),
/// so this needs the semantic model.
/// </summary>
internal sealed class CultureUnawareStringOperation : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/culture-unaware-string-operation";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.ContainingType?.SpecialType != SpecialType.System_String) continue;

            // Parameterless ToLower()/ToUpper() use the current culture. The *Invariant
            // variants and the CultureInfo overloads are culture-explicit and fine.
            var culprit = m.Name switch
            {
                "ToLower" or "ToUpper" when m.Parameters.Length == 0 => $"string.{m.Name}()",
                "Compare" when m.IsStatic && !HasComparisonOrCulture(m) => "string.Compare",
                _ => null,
            };
            if (culprit is null) continue;

            var pos = TargetLocation(inv).GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"{culprit} depends on the current culture — pass a CultureInfo (or use the Invariant/StringComparison overload) for portable results.");
        }
    }

    private static bool HasComparisonOrCulture(IMethodSymbol m) =>
        m.Parameters.Any(p =>
            p.Type is { Name: "StringComparison", ContainingNamespace.Name: "System" } ||
            p.Type is { Name: "CultureInfo" } ||
            p.Type.Name == "CompareOptions");

    private static Location TargetLocation(InvocationExpressionSyntax inv) =>
        inv.Expression is MemberAccessExpressionSyntax ma ? ma.Name.GetLocation() : inv.GetLocation();
}
