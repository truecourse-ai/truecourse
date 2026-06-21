using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A private method that is only ever called from inside one nested type of its
/// declaring type belongs in that nested type — keeping it on the outer class spreads
/// the nested type's logic across two scopes. Deciding this needs the whole
/// compilation's call sites resolved (a call can live in any analyzed file) plus the
/// lexical nesting of each one. S3398.
/// </summary>
internal sealed class PrivateMethodBelongsInNestedClass : ISemanticRule
{
    public string RuleKey => "architecture/deterministic/private-method-belongs-in-nested-class";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        var compilation = model.Compilation;

        foreach (var decl in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(decl) is not IMethodSymbol sym) continue;
            if (sym.DeclaredAccessibility != Accessibility.Private) continue;
            if (sym.IsStatic && sym.MethodKind != MethodKind.Ordinary) continue;
            if (sym.MethodKind != MethodKind.Ordinary) continue;

            var outer = sym.ContainingType;
            if (outer is null) continue;

            // The method must be declared directly on the OUTER type (not already nested),
            // and that outer type must actually contain nested types to move it into.
            if (outer.ContainingType is not null) continue;
            var nestedTypes = outer.GetTypeMembers();
            if (nestedTypes.Length == 0) continue;

            INamedTypeSymbol? soleNestedHost = null;
            var hasAnyCall = false;
            var escaped = false;

            foreach (var refTree in compilation.SyntaxTrees)
            {
                if (escaped) break;
                var refModel = compilation.GetSemanticModel(refTree);
                foreach (var id in refTree.GetRoot().DescendantNodes().OfType<IdentifierNameSyntax>())
                {
                    if (id.Identifier.Text != sym.Name) continue;
                    if (!SymbolEqualityComparer.Default.Equals(refModel.GetSymbolInfo(id).Symbol, sym)) continue;

                    hasAnyCall = true;
                    var host = EnclosingNestedTypeOf(refModel, id, outer);
                    if (host is null)
                    {
                        // A call from the outer type itself (or anywhere not inside one of
                        // its nested types) means the method does not belong purely nested.
                        escaped = true;
                        break;
                    }
                    if (soleNestedHost is null) soleNestedHost = host;
                    else if (!SymbolEqualityComparer.Default.Equals(soleNestedHost, host))
                    {
                        escaped = true; // used by two different nested types
                        break;
                    }
                }
            }

            if (escaped || !hasAnyCall || soleNestedHost is null) continue;

            var pos = decl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Private method '{sym.Name}' is used only by nested type '{soleNestedHost.Name}'; move it there for cohesion.");
        }
    }

    /// <summary>
    /// The direct nested type of <paramref name="outer"/> that lexically encloses
    /// <paramref name="node"/>, or null if the node is in <paramref name="outer"/>'s own
    /// body (not inside any of its nested types).
    /// </summary>
    private static INamedTypeSymbol? EnclosingNestedTypeOf(SemanticModel model, SyntaxNode node, INamedTypeSymbol outer)
    {
        INamedTypeSymbol? deepest = null;
        for (var anc = node.Parent; anc is not null; anc = anc.Parent)
        {
            if (anc is not TypeDeclarationSyntax td) continue;
            if (model.GetDeclaredSymbol(td) is not INamedTypeSymbol t) continue;

            if (SymbolEqualityComparer.Default.Equals(t, outer))
                return deepest; // reached the outer type; whatever nested type we passed is the host

            // Track the outermost nested type that is a direct child of `outer`.
            if (t.ContainingType is { } parent && SymbolEqualityComparer.Default.Equals(parent, outer))
                deepest = t;
        }
        return deepest;
    }
}
