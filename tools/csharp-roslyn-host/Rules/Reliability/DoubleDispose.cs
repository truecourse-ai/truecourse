using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A resource held by a <c>using</c> (statement or declaration) that is also
/// disposed explicitly inside the same scope. The <c>using</c> already disposes it
/// at scope exit, so the explicit <c>Dispose()</c>/<c>DisposeAsync()</c> is a second
/// disposal — undefined for many types and an outright <c>ObjectDisposedException</c>
/// for some (CA2202). The variable is matched through the semantic model, so only a
/// genuine second disposal of the same instance is flagged.
/// </summary>
internal sealed class DoubleDispose : ISemanticRule
{
    public string RuleKey => "reliability/deterministic/double-dispose";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var us in tree.GetRoot().DescendantNodes().OfType<UsingStatementSyntax>())
        {
            if (us.Declaration is null) continue;
            foreach (var v in us.Declaration.Variables)
                if (model.GetDeclaredSymbol(v) is ILocalSymbol sym)
                    foreach (var hit in ExplicitDisposals(us.Statement, sym, model))
                        yield return Make(tree, sym, hit);
        }

        foreach (var decl in tree.GetRoot().DescendantNodes().OfType<LocalDeclarationStatementSyntax>())
        {
            if (!decl.UsingKeyword.IsKind(SyntaxKind.UsingKeyword)) continue; // using declaration only
            if (decl.Parent is not BlockSyntax block) continue;
            foreach (var v in decl.Declaration.Variables)
                if (model.GetDeclaredSymbol(v) is ILocalSymbol sym)
                    foreach (var hit in ExplicitDisposals(block, sym, model))
                        yield return Make(tree, sym, hit);
        }
    }

    private Violation Make(SyntaxTree tree, ILocalSymbol sym, SyntaxNode hit)
    {
        var pos = hit.GetLocation().GetLineSpan().StartLinePosition;
        return new Violation(
            RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
            $"'{sym.Name}' is held by a using and disposed again here — the using already disposes it at scope exit.");
    }

    private static IEnumerable<SyntaxNode> ExplicitDisposals(SyntaxNode scope, ILocalSymbol sym, SemanticModel model)
    {
        foreach (var inv in scope.DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.Text is not ("Dispose" or "DisposeAsync")) continue;
            if (SymbolEqualityComparer.Default.Equals(model.GetSymbolInfo(ma.Expression).Symbol, sym))
                yield return ma.Name;
        }
    }
}
