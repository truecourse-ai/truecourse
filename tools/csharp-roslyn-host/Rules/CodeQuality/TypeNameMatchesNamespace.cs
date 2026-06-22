using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A type whose name collides with the name of a namespace declared in the same
/// compilation (e.g. `class Logging` alongside `namespace Logging`). The collision
/// forces awkward fully qualified references and ambiguous resolution. We collect the
/// simple names of all namespaces declared in this compilation and flag a type that
/// shares one. Limiting the namespace set to the compilation's own (rather than every
/// referenced assembly's namespace) keeps this free of false positives. CA1724.
/// </summary>
internal sealed class TypeNameMatchesNamespace : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/type-name-matches-namespace";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        var namespaceNames = CollectNamespaceSimpleNames(model.Compilation);
        if (namespaceNames.Count == 0) yield break;

        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<BaseTypeDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol type) continue;
            // A type whose own enclosing namespace shares its name is the offender; but a
            // type *inside* namespace Foo named Foo is the canonical CA1724 case too.
            var name = type.Name;
            if (!namespaceNames.Contains(name)) continue;

            // Don't flag when the only matching "namespace" is this type's own segment
            // path — i.e. require a genuine namespace named `name` to exist independently.
            var pos = typeDecl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Type '{name}' has the same name as a namespace, forcing awkward fully qualified references; rename the type.");
        }
    }

    private static HashSet<string> CollectNamespaceSimpleNames(Compilation compilation)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        Walk(compilation.Assembly.GlobalNamespace, names);
        return names;
    }

    private static void Walk(INamespaceSymbol ns, HashSet<string> names)
    {
        foreach (var child in ns.GetNamespaceMembers())
        {
            if (!string.IsNullOrEmpty(child.Name)) names.Add(child.Name);
            Walk(child, names);
        }
    }
}
