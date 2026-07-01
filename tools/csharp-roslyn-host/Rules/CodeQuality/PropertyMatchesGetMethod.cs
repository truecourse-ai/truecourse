using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A type that declares both a property `Foo` and a method `GetFoo()` (or property
/// `GetFoo` and method `Foo` — the `Get`-prefixed pair). Callers cannot tell which one
/// exposes the value, and the redundancy signals one should be removed. This is a true
/// name collision, not a "method should be a property" heuristic: both members must
/// actually exist. We require the method to be parameterless so it is a genuine
/// accessor counterpart. CA1721.
///
/// One narrow exemption: a property whose getter body is exactly `GetFoo()` (an
/// expression-bodied property `Foo => GetFoo()`, a `get => GetFoo()`, or a
/// `get { return GetFoo(); }`) delegates to the method — a single implementation
/// exposed through the property surface, the idiomatic "public property over an
/// overridable `GetFoo()`" pattern — not two competing ways to obtain the value.
/// </summary>
internal sealed class PropertyMatchesGetMethod : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/property-matches-get-method";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol type) continue;

            var properties = new HashSet<string>(
                type.GetMembers().OfType<IPropertySymbol>()
                    .Where(p => !p.IsIndexer && p.CanBeReferencedByName)
                    .Select(p => p.Name),
                StringComparer.Ordinal);
            if (properties.Count == 0) continue;

            foreach (var method in type.GetMembers().OfType<IMethodSymbol>())
            {
                if (method.MethodKind != MethodKind.Ordinary) continue;
                if (method.Parameters.Length != 0) continue;
                if (!method.Name.StartsWith("Get", StringComparison.Ordinal)) continue;
                if (method.Name.Length <= 3) continue;

                var bare = method.Name.Substring(3);
                // `GetFoo()` collides with a property `Foo` (or, symmetrically, the type
                // has both `GetFoo` method and `GetFoo` property — caught via `properties`).
                var collides = properties.Contains(bare);
                if (!collides) continue;

                // Skip when the property `Foo` merely delegates to `GetFoo()` — one
                // implementation surfaced through the property, not a redundant pair.
                var prop = type.GetMembers(bare).OfType<IPropertySymbol>()
                    .FirstOrDefault(p => !p.IsIndexer);
                if (prop != null && PropertyDelegatesTo(prop, method.Name)) continue;

                var node = method.DeclaringSyntaxReferences
                    .Select(r => r.GetSyntax())
                    .OfType<MethodDeclarationSyntax>()
                    .FirstOrDefault(n => n.SyntaxTree == tree);
                if (node is null) continue;

                var pos = node.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Method '{method.Name}' collides with property '{bare}' on '{type.Name}'; the pair confuses which exposes the value — keep one.");
            }
        }
    }

    /// <summary>
    /// True when the property's getter body is exactly `methodName()` (bare or
    /// `this.methodName()`), i.e. the property delegates to the method.
    /// </summary>
    private static bool PropertyDelegatesTo(IPropertySymbol prop, string methodName)
    {
        foreach (var reference in prop.DeclaringSyntaxReferences)
        {
            if (reference.GetSyntax() is not PropertyDeclarationSyntax decl) continue;

            ExpressionSyntax? getterExpr = null;
            if (decl.ExpressionBody != null)
            {
                getterExpr = decl.ExpressionBody.Expression;
            }
            else if (decl.AccessorList != null)
            {
                var getter = decl.AccessorList.Accessors
                    .FirstOrDefault(a => a.Keyword.ValueText == "get");
                if (getter?.ExpressionBody != null)
                    getterExpr = getter.ExpressionBody.Expression;
                else if (getter?.Body is { Statements.Count: 1 } body
                         && body.Statements[0] is ReturnStatementSyntax ret)
                    getterExpr = ret.Expression;
            }

            if (IsZeroArgCallTo(getterExpr, methodName)) return true;
        }
        return false;
    }

    private static bool IsZeroArgCallTo(ExpressionSyntax? expr, string methodName)
    {
        if (expr is not InvocationExpressionSyntax inv) return false;
        if (inv.ArgumentList.Arguments.Count != 0) return false;
        var name = inv.Expression switch
        {
            IdentifierNameSyntax id => id.Identifier.Text,
            MemberAccessExpressionSyntax ma when ma.Expression is ThisExpressionSyntax
                => ma.Name.Identifier.Text,
            _ => null,
        };
        return name == methodName;
    }
}
