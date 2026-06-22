using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An externally-visible method dereferences a reference-type parameter without first
/// guarding it against null, so callers who pass null get an opaque
/// NullReferenceException deep inside the method instead of a clear
/// ArgumentNullException at the boundary. Needs the semantic model to resolve the
/// dereferenced symbol back to a by-value reference-type parameter and to confirm no
/// guard exists. CA1062.
/// </summary>
internal sealed class MissingPublicArgumentValidation : ISemanticRule
{
    public string RuleKey => "architecture/deterministic/missing-public-argument-validation";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            var body = (SyntaxNode?)method.Body ?? method.ExpressionBody;
            if (body is null) continue;
            if (method.ParameterList.Parameters.Count == 0) continue;

            if (model.GetDeclaredSymbol(method) is not IMethodSymbol sym) continue;

            // Externally reachable only: the method and its containing type must both be
            // effectively public/protected. Internal/private surface is the author's own.
            if (!IsExternallyVisible(sym) || sym.ContainingType is null || !IsExternallyVisible(sym.ContainingType))
                continue;

            foreach (var p in method.ParameterList.Parameters)
            {
                if (model.GetDeclaredSymbol(p) is not IParameterSymbol ps) continue;
                if (!IsGuardableReferenceParameter(ps)) continue;

                // Only flag in nullable-OBLIVIOUS code (annotation None). When the
                // nullable context is enabled, a non-`?` parameter (NotAnnotated) is
                // compiler-guaranteed non-null and a guard is redundant, and a `?`
                // parameter (Annotated) is an intentional may-be-null contract. Either
                // way the missing-guard finding is a false positive under NRT.
                if (ps.NullableAnnotation != NullableAnnotation.None) continue;

                if (HasNullGuard(body, model, ps)) continue;

                var deref = FirstUnconditionalDereference(body, model, ps);
                if (deref is null) continue;

                var pos = deref.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Public method '{sym.Name}' dereferences parameter '{ps.Name}' without a null check; callers passing null get an opaque NullReferenceException.");
            }
        }
    }

    private static bool IsExternallyVisible(ISymbol s) =>
        s.DeclaredAccessibility is Accessibility.Public or Accessibility.Protected or Accessibility.ProtectedOrInternal;

    private static bool IsGuardableReferenceParameter(IParameterSymbol p)
    {
        if (p.RefKind is RefKind.Out or RefKind.Ref or RefKind.In) return false;
        if (p.IsParams) return false;
        var t = p.Type;
        // Only reference types can be null. Delegates and arrays count, but skip
        // pointers and type parameters (their nullability/dereference is unclear).
        if (t.TypeKind == TypeKind.TypeParameter) return false;
        if (!t.IsReferenceType) return false;
        // `string` derefs (e.g. .Length) are real, but the canonical pattern targets
        // any reference type; keep it broad but exclude object (often just stored).
        return true;
    }

    /// <summary>True if the body contains any null check or guard touching <paramref name="p"/>.</summary>
    private static bool HasNullGuard(SyntaxNode body, SemanticModel model, IParameterSymbol p)
    {
        foreach (var node in body.DescendantNodes())
        {
            switch (node)
            {
                // x == null / null == x / x != null
                case BinaryExpressionSyntax be when
                    be.IsKind(SyntaxKind.EqualsExpression) || be.IsKind(SyntaxKind.NotEqualsExpression):
                    if (TouchesNull(be.Left, be.Right, model, p)) return true;
                    break;

                // x is null / x is not null / x is {}  (constant + recursive patterns)
                case IsPatternExpressionSyntax ip when RefersTo(ip.Expression, model, p):
                    return true;

                // x?.Member — null-conditional access already short-circuits
                case ConditionalAccessExpressionSyntax ca when RefersTo(ca.Expression, model, p):
                    return true;

                // x ?? throw / x ?? default
                case BinaryExpressionSyntax co when co.IsKind(SyntaxKind.CoalesceExpression) &&
                    RefersTo(co.Left, model, p):
                    return true;

                // ArgumentNullException.ThrowIfNull(x) and similar guard helpers
                case InvocationExpressionSyntax inv when IsGuardCall(inv, model, p):
                    return true;
            }
        }
        return false;
    }

    private static bool TouchesNull(ExpressionSyntax a, ExpressionSyntax b, SemanticModel model, IParameterSymbol p)
    {
        if (a.IsKind(SyntaxKind.NullLiteralExpression) && RefersTo(b, model, p)) return true;
        if (b.IsKind(SyntaxKind.NullLiteralExpression) && RefersTo(a, model, p)) return true;
        return false;
    }

    private static bool IsGuardCall(InvocationExpressionSyntax inv, SemanticModel model, IParameterSymbol p)
    {
        var name = (inv.Expression as MemberAccessExpressionSyntax)?.Name.Identifier.Text
                   ?? (inv.Expression as IdentifierNameSyntax)?.Identifier.Text;
        if (name is not ("ThrowIfNull" or "ThrowIfNullOrEmpty" or "ThrowIfNullOrWhiteSpace"
            or "RequireNonNull" or "NotNull" or "ArgumentNotNull")) return false;
        return inv.ArgumentList.Arguments.Any(arg =>
            RefersTo(arg.Expression, model, p) ||
            (arg.Expression is InvocationExpressionSyntax nameof &&
             (nameof.Expression as IdentifierNameSyntax)?.Identifier.Text == "nameof" &&
             nameof.ArgumentList.Arguments.Count == 1 &&
             RefersTo(nameof.ArgumentList.Arguments[0].Expression, model, p)));
    }

    /// <summary>
    /// The first member-access / element-access / invocation whose receiver is exactly
    /// <paramref name="p"/> and that is NOT a null-conditional access — a real
    /// unconditional dereference.
    /// </summary>
    private static SyntaxNode? FirstUnconditionalDereference(SyntaxNode body, SemanticModel model, IParameterSymbol p)
    {
        foreach (var node in body.DescendantNodes())
        {
            switch (node)
            {
                case MemberAccessExpressionSyntax ma when
                    ma.IsKind(SyntaxKind.SimpleMemberAccessExpression) && RefersTo(ma.Expression, model, p):
                    return ma;
                case ElementAccessExpressionSyntax ea when RefersTo(ea.Expression, model, p):
                    return ea;
            }
        }
        return null;
    }

    /// <summary>True when <paramref name="expr"/> is an identifier bound to parameter <paramref name="p"/>.</summary>
    private static bool RefersTo(ExpressionSyntax? expr, SemanticModel model, IParameterSymbol p)
    {
        if (expr is not IdentifierNameSyntax id) return false;
        return SymbolEqualityComparer.Default.Equals(model.GetSymbolInfo(id).Symbol, p);
    }
}
