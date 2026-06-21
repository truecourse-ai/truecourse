using Microsoft.CodeAnalysis;

namespace TrueCourse.RoslynHost;

/// <summary>
/// Shared efferent-coupling measurement: the set of distinct named types a syntax
/// subtree refers to, excluding the analyzed type itself and the noise types that
/// would inflate every count (void, the special framework primitives, anonymous /
/// error types). Used by the class-coupling (S1200) and class/method-coupling
/// (CA1506) rules so they measure coupling the same way.
/// </summary>
internal static class Coupling
{
    /// <summary>
    /// Distinct user-meaningful types referenced anywhere under <paramref name="scope"/>,
    /// resolved with <paramref name="model"/>. <paramref name="self"/> (the enclosing
    /// type) is never counted against itself.
    /// </summary>
    public static int DistinctReferencedTypes(SemanticModel model, SyntaxNode scope, INamedTypeSymbol self)
    {
        var seen = new HashSet<INamedTypeSymbol>(SymbolEqualityComparer.Default);
        foreach (var node in scope.DescendantNodesAndSelf())
        {
            var t = model.GetTypeInfo(node).Type;
            Add(seen, t, self);

            if (model.GetSymbolInfo(node).Symbol is { } sym)
            {
                Add(seen, sym as INamedTypeSymbol, self);
                if (sym is IMethodSymbol m && !m.ReturnsVoid) Add(seen, m.ReturnType, self);
            }
        }
        return seen.Count;
    }

    private static void Add(HashSet<INamedTypeSymbol> set, ITypeSymbol? type, INamedTypeSymbol self)
    {
        if (type is not INamedTypeSymbol named) return;

        // Unwrap to the original generic definition so List<int> and List<string>
        // count once, and unwrap nullable value types (Nullable<T> -> T noise).
        named = named.OriginalDefinition;

        if (named.TypeKind is TypeKind.Error or TypeKind.Dynamic) return;
        if (named.IsAnonymousType) return;
        if (SymbolEqualityComparer.Default.Equals(named, self)) return;

        switch (named.SpecialType)
        {
            // The ubiquitous primitives/built-ins are coupling noise: counting them
            // would penalize every type that touches an int or a string.
            case SpecialType.System_Object:
            case SpecialType.System_Void:
            case SpecialType.System_Boolean:
            case SpecialType.System_Byte:
            case SpecialType.System_SByte:
            case SpecialType.System_Int16:
            case SpecialType.System_UInt16:
            case SpecialType.System_Int32:
            case SpecialType.System_UInt32:
            case SpecialType.System_Int64:
            case SpecialType.System_UInt64:
            case SpecialType.System_Single:
            case SpecialType.System_Double:
            case SpecialType.System_Decimal:
            case SpecialType.System_Char:
            case SpecialType.System_String:
            case SpecialType.System_IntPtr:
            case SpecialType.System_UIntPtr:
            case SpecialType.System_Nullable_T:
                return;
        }

        set.Add(named);
    }
}
