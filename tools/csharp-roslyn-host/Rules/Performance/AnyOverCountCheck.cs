using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `Enumerable.Any()` (no predicate) called only to test emptiness on a receiver
/// that already exposes a cheap O(1) length — an array (`Length`), or a type with
/// a `Count` property (`ICollection`/`List`), or a `Span`/`string`. `Any()` builds
/// an enumerator; the property is allocation-free. Receiver type resolution is what
/// makes this precise. CA1860.
/// </summary>
internal sealed class AnyOverCountCheck : ISemanticRule
{
    public string RuleKey => "performance/deterministic/any-over-count-check";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.Text != "Any") continue;
            if (inv.ArgumentList.Arguments.Count != 0) continue; // predicate-less only

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.Name != "Any" || !m.IsExtensionMethod ||
                m.ContainingType?.Name != "Enumerable") continue;

            var recv = model.GetTypeInfo(ma.Expression).Type;
            if (recv is null || !HasCheapLength(recv)) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Any() builds an enumerator to test emptiness on a type with a cheap Count/Length/IsEmpty — use that property instead.");
        }
    }

    private static bool HasCheapLength(ITypeSymbol type)
    {
        if (type.TypeKind == TypeKind.Array) return true; // .Length
        if (type is { Name: "Span" or "ReadOnlySpan" or "Memory" or "ReadOnlyMemory" }) return true;
        if (type.SpecialType == SpecialType.System_String) return true;

        // A Count or Length property declared on the type or one of its interfaces
        // (ICollection<T>.Count, IReadOnlyCollection<T>.Count, …).
        if (HasCountProperty(type)) return true;
        foreach (var iface in type.AllInterfaces)
            if (HasCountProperty(iface)) return true;
        return false;
    }

    private static bool HasCountProperty(ITypeSymbol type)
    {
        for (var t = type; t is not null; t = t.BaseType)
            foreach (var member in t.GetMembers())
                if (member is IPropertySymbol { Name: "Count" or "Length", DeclaredAccessibility: Accessibility.Public })
                    return true;
        return false;
    }
}
