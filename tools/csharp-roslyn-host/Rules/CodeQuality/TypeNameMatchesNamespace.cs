using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A top-level type whose name matches a sibling or parent namespace, forcing
/// awkward fully qualified references when both are in scope. CA1724.
///
/// Three collision patterns are detected:
/// 1. Sibling namespace: `class Foo` in `App` when `App.Foo` also exists.
/// 2. Top-level namespace: `class Logging` in `App` when root namespace `Logging` exists.
/// 3. Self-containing namespace: `class Logging` inside `namespace X.Y.Logging` — the
///    class name matches the simple name of its own enclosing namespace, producing the
///    qualified name `X.Y.Logging.Logging` and creating ambiguity for any caller who
///    imports `X.Y`.
///
/// Scoping rule: nested types are always skipped — a nested type is accessed through
/// its enclosing type and cannot cause namespace ambiguity at the use site.
/// </summary>
internal sealed class TypeNameMatchesNamespace : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/type-name-matches-namespace";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<BaseTypeDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol type) continue;
            // Nested types are accessed through their enclosing type and cannot create
            // namespace ambiguity — skip them.
            if (type.ContainingType != null) continue;

            var name = type.Name;
            var containingNs = type.ContainingNamespace;

            // A genuine CA1724 collision: the type's containing namespace has a direct
            // child namespace with the same simple name as the type. For example:
            //   namespace App { class Logging { } }   +   namespace App.Logging { ... }
            // This is the scenario that forces `App.Logging` to be ambiguous between
            // the type and the sub-namespace when `using App;` is in scope.
            if (!HasConflictingNamespace(type, name)) continue;

            var pos = typeDecl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Type '{name}' collides with a namespace of the same name, forcing awkward fully qualified references; rename the type.");
        }
    }

    private static bool HasConflictingNamespace(INamedTypeSymbol type, string typeName)
    {
        var containingNs = type.ContainingNamespace;

        // Pattern 1 — same-level sibling: the type's direct parent namespace has a
        // child namespace with the same name (e.g. class Foo in App when App.Foo
        // also exists as a namespace). Both the type and the sub-namespace are
        // exposed by the same using directive, forcing awkward disambiguation.
        if (containingNs.GetNamespaceMembers().Any(child => child.Name == typeName))
            return true;

        // Pattern 2 — top-level namespace: a root namespace matches the type's
        // simple name. High-impact: any file with `using RootNs;` faces ambiguity.
        var root = containingNs;
        while (!root.IsGlobalNamespace) root = root.ContainingNamespace!;
        if (root.GetNamespaceMembers().Any(child => child.Name == typeName))
            return true;

        // Pattern 3 — self-containing namespace: the type's own enclosing namespace
        // has the same simple name (e.g. class Logging inside namespace X.Y.Logging).
        // The fully qualified name becomes X.Y.Logging.Logging, and any caller
        // importing X.Y sees `Logging` as both the namespace and the type name.
        if (!containingNs.IsGlobalNamespace && containingNs.Name == typeName)
            return true;

        return false;
    }
}
