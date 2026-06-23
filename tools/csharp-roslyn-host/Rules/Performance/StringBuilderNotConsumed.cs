using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A local <c>StringBuilder</c> that is appended to but whose accumulated string is
/// never read — every reference is a fire-and-forget mutation (<c>Append</c> &amp;c.)
/// whose result is discarded, and nothing ever calls <c>ToString</c>, reads
/// <c>Length</c>, returns it, or passes it on. The whole buffer is dead work.
/// Conservative by construction: the moment a reference is anything other than a
/// discarded mutating call (a fluent chain ending in <c>ToString</c>, an argument,
/// an assignment), the builder counts as consumed and is not flagged.
/// </summary>
internal sealed class StringBuilderNotConsumed : ISemanticRule
{
    private static readonly HashSet<string> Mutations = new()
    {
        "Append", "AppendLine", "AppendFormat", "AppendJoin", "Insert", "Remove", "Replace", "Clear",
    };

    public string RuleKey => "performance/deterministic/stringbuilder-not-consumed";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var decl in tree.GetRoot().DescendantNodes().OfType<LocalDeclarationStatementSyntax>())
        {
            foreach (var v in decl.Declaration.Variables)
            {
                if (v.Initializer is null) continue;
                if (model.GetDeclaredSymbol(v) is not ILocalSymbol local) continue;
                if (!IsStringBuilder(local.Type)) continue;

                var scope = decl.Parent;
                if (scope is null) continue;
                var refs = scope.DescendantNodes().OfType<IdentifierNameSyntax>()
                    .Where(id => SymbolEqualityComparer.Default.Equals(model.GetSymbolInfo(id).Symbol, local))
                    .ToList();
                if (refs.Count == 0) continue;
                if (!refs.All(IsDiscardedMutation)) continue;

                var pos = v.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"StringBuilder '{local.Name}' is appended to but its result is never read — the built string is discarded.");
            }
        }
    }

    private static bool IsStringBuilder(ITypeSymbol? type) =>
        type?.Name == "StringBuilder" && type.ContainingNamespace?.ToDisplayString() == "System.Text";

    /// <summary>True when this reference is `sb.Mutation(...)` standing alone as a statement.</summary>
    private static bool IsDiscardedMutation(IdentifierNameSyntax id)
    {
        if (id.Parent is not MemberAccessExpressionSyntax ma || ma.Expression != id) return false;
        if (!Mutations.Contains(ma.Name.Identifier.Text)) return false;
        if (ma.Parent is not InvocationExpressionSyntax inv) return false;
        return inv.Parent is ExpressionStatementSyntax;
    }
}
