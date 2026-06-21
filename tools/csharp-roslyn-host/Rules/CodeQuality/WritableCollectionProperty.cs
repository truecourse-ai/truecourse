using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A property of a mutable collection type that exposes a public setter, letting
/// callers replace the entire collection (and bypass any add/remove invariants).
/// Such properties should be getter-only. Needs the resolved property type to know it
/// is a writable collection (ICollection&lt;T&gt;), and to exclude arrays and
/// read-only collection interfaces. S4004 / CA2227.
/// </summary>
internal sealed class WritableCollectionProperty : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/writable-collection-property";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var prop in tree.GetRoot().DescendantNodes().OfType<PropertyDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(prop) is not IPropertySymbol sym) continue;
            if (sym.SetMethod is null) continue;
            // Only a publicly-settable property is the hazard.
            if (sym.SetMethod.DeclaredAccessibility != Accessibility.Public) continue;
            if (sym.DeclaredAccessibility != Accessibility.Public) continue;
            // init-only setters already prevent post-construction replacement.
            if (sym.SetMethod.IsInitOnly) continue;
            if (sym.IsStatic) continue;

            var type = sym.Type;
            // Arrays are intentionally assignable and out of CA2227's scope.
            if (type.TypeKind == TypeKind.Array) continue;
            // String is IEnumerable<char> but is not a collection in this sense.
            if (type.SpecialType == SpecialType.System_String) continue;
            // The collection must be MUTABLE: implement ICollection<T> / ICollection.
            // Read-only collection interfaces (IReadOnlyList<T>, IEnumerable<T>) are fine
            // to expose with a setter because callers can't mutate the elements anyway —
            // CA2227 targets the writable ones.
            if (!ImplementsMutableCollection(type)) continue;

            var pos = prop.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Collection property '{sym.Name}' has a public setter; expose it as get-only so callers cannot replace the whole collection.");
        }
    }

    private static bool ImplementsMutableCollection(ITypeSymbol type)
    {
        bool IsCollection(INamedTypeSymbol i) =>
            (i.Name == "ICollection" && i.ContainingNamespace?.ToDisplayString() == "System.Collections.Generic") ||
            (i.Name == "ICollection" && i.ContainingNamespace?.ToDisplayString() == "System.Collections");

        if (type is INamedTypeSymbol named && IsCollection(named)) return true;
        return type.AllInterfaces.Any(IsCollection);
    }
}
