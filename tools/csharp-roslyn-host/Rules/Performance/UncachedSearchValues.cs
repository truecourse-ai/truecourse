using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `IndexOfAny` / `IndexOfAnyExcept` / `ContainsAny` / `ContainsAnyExcept` (on a
/// span or string) passed an inline set of values — a string/array literal or a
/// `new[] { … }` — instead of a cached `SearchValues&lt;T&gt;` instance. The inline
/// values are re-scanned on every call; a `SearchValues` built once uses a vectorized
/// lookup table. Binding the call to the span/string method and seeing a literal
/// argument (not an already-cached SearchValues) is what makes this precise. CA1870.
/// </summary>
internal sealed class UncachedSearchValues : ISemanticRule
{
    private static readonly HashSet<string> Methods = new()
    {
        "IndexOfAny", "IndexOfAnyExcept", "ContainsAny", "ContainsAnyExcept",
        "LastIndexOfAny", "LastIndexOfAnyExcept",
    };

    public string RuleKey => "performance/deterministic/uncached-searchvalues";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (!Methods.Contains(ma.Name.Identifier.Text)) continue;
            if (inv.ArgumentList.Arguments.Count < 1) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (!Methods.Contains(m.Name)) continue;
            if (!IsSpanOrString(m.ContainingType)) continue;

            // Only flag when the value set is an inline literal/array — a hoisted
            // SearchValues field or local is already the recommended form.
            var valuesArg = inv.ArgumentList.Arguments[0].Expression;
            if (!IsInlineValueSet(valuesArg)) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"{m.Name} is passed an inline value set, re-scanned each call — cache a static SearchValues<T> and pass that instead.");
        }
    }

    private static bool IsSpanOrString(ITypeSymbol? type) =>
        type is { SpecialType: SpecialType.System_String } or
        INamedTypeSymbol { Name: "MemoryExtensions" } or
        INamedTypeSymbol { Name: "Span" or "ReadOnlySpan" };

    private static bool IsInlineValueSet(ExpressionSyntax e)
    {
        while (e is ParenthesizedExpressionSyntax p) e = p.Expression;
        return e is LiteralExpressionSyntax ||                       // "abc"
               e is ArrayCreationExpressionSyntax ||                 // new char[] { ... }
               e is ImplicitArrayCreationExpressionSyntax ||         // new[] { ... }
               e is StackAllocArrayCreationExpressionSyntax ||       // stackalloc[]
               e is ImplicitStackAllocArrayCreationExpressionSyntax ||
               e is CollectionExpressionSyntax;                      // [ 'a', 'b' ]
    }
}
