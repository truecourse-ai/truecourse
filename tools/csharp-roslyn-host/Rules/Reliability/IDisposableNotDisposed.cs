using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A local that owns a freshly-<c>new</c>'d <see cref="System.IDisposable"/> and
/// never releases it — no <c>using</c>, no <c>Dispose()</c>, and the reference never
/// escapes (it is not returned, assigned away, or passed as an argument, so no other
/// code can own or dispose it). The unmanaged handle leaks. Deliberately
/// conservative: the moment the value escapes — ownership might transfer — or is
/// disposed, it is cleared, so only an unambiguous local leak is flagged.
/// </summary>
internal sealed class IDisposableNotDisposed : ISemanticRule
{
    public string RuleKey => "reliability/deterministic/idisposable-not-disposed";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var decl in tree.GetRoot().DescendantNodes().OfType<LocalDeclarationStatementSyntax>())
        {
            if (decl.UsingKeyword.IsKind(Microsoft.CodeAnalysis.CSharp.SyntaxKind.UsingKeyword)) continue;
            if (decl.Parent is not BlockSyntax block) continue;

            foreach (var v in decl.Declaration.Variables)
            {
                if (v.Initializer?.Value is not ObjectCreationExpressionSyntax) continue;
                if (model.GetDeclaredSymbol(v) is not ILocalSymbol local) continue;
                if (!IsDisposable(local.Type)) continue;

                var refs = block.DescendantNodes().OfType<IdentifierNameSyntax>()
                    .Where(id => SymbolEqualityComparer.Default.Equals(model.GetSymbolInfo(id).Symbol, local))
                    .ToList();
                if (refs.Count == 0) continue;

                var disposed = false;
                var escaped = false;
                foreach (var r in refs)
                {
                    switch (Classify(r))
                    {
                        case Use.Dispose: disposed = true; break;
                        case Use.Escape: escaped = true; break;
                    }
                }
                if (disposed || escaped) continue;

                var pos = v.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"'{local.Name}' owns an IDisposable that is never disposed — wrap it in a using or call Dispose().");
            }
        }
    }

    private enum Use { Local, Dispose, Escape }

    private static Use Classify(IdentifierNameSyntax r)
    {
        if (r.Parent is MemberAccessExpressionSyntax ma && ma.Expression == r)
            return ma.Name.Identifier.Text is "Dispose" or "DisposeAsync" ? Use.Dispose : Use.Local;
        if (r.Parent is ConditionalAccessExpressionSyntax ca && ca.Expression == r)
            return ca.WhenNotNull.DescendantNodesAndSelf().OfType<MemberBindingExpressionSyntax>()
                .Any(mb => mb.Name.Identifier.Text is "Dispose" or "DisposeAsync") ? Use.Dispose : Use.Local;
        return Use.Escape;
    }

    private static bool IsDisposable(ITypeSymbol? type)
    {
        if (type is null) return false;
        foreach (var i in type.AllInterfaces)
            if (i.Name is "IDisposable" or "IAsyncDisposable" && i.ContainingNamespace?.ToDisplayString() == "System")
                return true;
        return false;
    }
}
