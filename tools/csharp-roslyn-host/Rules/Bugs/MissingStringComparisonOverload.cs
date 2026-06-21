using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A culture-sensitive `string` comparison method (Equals, StartsWith, EndsWith, IndexOf,
/// LastIndexOf, Compare, CompareTo) is called on a string WITHOUT a StringComparison
/// argument, even though an overload that takes one exists. The default culture sensitivity
/// is then implicit and surprising. We confirm via the semantic model that (a) the bound
/// method is on System.String, (b) no StringComparison is already supplied, and (c) a
/// sibling overload taking StringComparison exists — so the fix is real. CA1307/CA1309/CA1310/S4058.
/// </summary>
internal sealed class MissingStringComparisonOverload : ISemanticRule
{
    private static readonly HashSet<string> Targets = new(StringComparer.Ordinal)
    {
        "Equals", "StartsWith", "EndsWith", "IndexOf", "LastIndexOf", "Compare", "CompareTo",
    };

    public string RuleKey => "bugs/deterministic/missing-stringcomparison-overload";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.ContainingType?.SpecialType != SpecialType.System_String) continue;
            if (!Targets.Contains(m.Name)) continue;

            // Already culture-explicit? Then nothing to flag.
            if (m.Parameters.Any(IsStringComparison)) continue;

            // IndexOf/StartsWith/Equals etc. that take a char argument are ordinal by
            // definition and have no StringComparison overload — don't flag those.
            if (HasCharArgument(m)) continue;

            // Only flag when a StringComparison-bearing sibling actually exists, so the
            // suggested fix is valid. (Equals/CompareTo on string both have one.)
            var hasOverload = m.ContainingType.GetMembers(m.Name).OfType<IMethodSymbol>()
                .Any(o => o.Parameters.Any(IsStringComparison));
            if (!hasOverload) continue;

            var pos = TargetLocation(inv).GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"string.{m.Name} is culture-sensitive — pass an explicit StringComparison (e.g. StringComparison.Ordinal) to make the intent clear.");
        }
    }

    private static bool IsStringComparison(IParameterSymbol p) =>
        p.Type is { Name: "StringComparison", ContainingNamespace.Name: "System" };

    private static bool HasCharArgument(IMethodSymbol m) =>
        m.Parameters.Length > 0 && m.Parameters[0].Type.SpecialType == SpecialType.System_Char;

    private static Location TargetLocation(InvocationExpressionSyntax inv) =>
        inv.Expression is MemberAccessExpressionSyntax ma ? ma.Name.GetLocation() : inv.GetLocation();
}
