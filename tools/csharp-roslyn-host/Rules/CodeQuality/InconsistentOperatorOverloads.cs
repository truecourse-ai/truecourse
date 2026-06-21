using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A type that overloads one operator of a complementary pair but not the other:
/// `==` without `!=`, `&lt;` without `&gt;`, `&lt;=` without `&gt;=` (and vice
/// versa). Roslyn's full member set is the reliable way to detect the gaps across
/// partial declarations. S4050 / CA2224.
/// </summary>
internal sealed class InconsistentOperatorOverloads : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/inconsistent-operator-overloads";

    private static readonly (string a, string b)[] Pairs =
    {
        ("op_Equality", "op_Inequality"),
        ("op_LessThan", "op_GreaterThan"),
        ("op_LessThanOrEqual", "op_GreaterThanOrEqual"),
    };

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol type) continue;

            // Dedupe across partial parts: only the lexically-first declaring reference
            // of this type (across all trees) reports. Compare by span+path.
            if (!IsPrimaryDeclaration(type, typeDecl)) continue;

            var ops = new HashSet<string>(
                type.GetMembers().OfType<IMethodSymbol>()
                    .Where(m => m.MethodKind == MethodKind.UserDefinedOperator)
                    .Select(m => m.Name));
            if (ops.Count == 0) continue;

            foreach (var (a, b) in Pairs)
            {
                string? present = ops.Contains(a) && !ops.Contains(b) ? a
                    : ops.Contains(b) && !ops.Contains(a) ? b
                    : null;
                if (present is null) continue;
                var missing = present == a ? b : a;

                var pos = typeDecl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"'{type.Name}' overloads {Symbolize(present)} but not its complement {Symbolize(missing)}; define both.");
            }
        }
    }

    private static bool IsPrimaryDeclaration(INamedTypeSymbol type, TypeDeclarationSyntax decl)
    {
        var first = type.DeclaringSyntaxReferences
            .OrderBy(r => r.SyntaxTree.FilePath, StringComparer.Ordinal)
            .ThenBy(r => r.Span.Start)
            .FirstOrDefault();
        return first is not null &&
               first.SyntaxTree.FilePath == decl.SyntaxTree.FilePath &&
               first.Span == decl.Span;
    }

    private static string Symbolize(string opName) => opName switch
    {
        "op_Equality" => "==",
        "op_Inequality" => "!=",
        "op_LessThan" => "<",
        "op_GreaterThan" => ">",
        "op_LessThanOrEqual" => "<=",
        "op_GreaterThanOrEqual" => ">=",
        _ => opName,
    };
}
