using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An indexer (`this[...]`) keyed by an unusual type — anything other than a string
/// or an integral type. `collection[someEnum]` or `collection[someCustomStruct]`
/// reads like an array access but isn't, hiding intent that a named method would make
/// explicit. We resolve the single key parameter's type and flag only clearly
/// non-standard keys.
/// </summary>
internal sealed class IndexerNonStandardKeyType : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/indexer-non-standard-key-type";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var indexer in tree.GetRoot().DescendantNodes().OfType<IndexerDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(indexer) is not IPropertySymbol prop) continue;
            // Multi-parameter indexers are matrix-style and intentionally not a lookup;
            // out of scope.
            if (prop.Parameters.Length != 1) continue;

            var keyType = prop.Parameters[0].Type;
            if (IsStandardKey(keyType)) continue;

            var pos = indexer.ThisKeyword.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Indexer is keyed by '{keyType.ToDisplayString()}'; string or integral keys read as lookups — use a named method for an unusual key type.");
        }
    }

    private static bool IsStandardKey(ITypeSymbol type)
    {
        // Unwrap Nullable<T> so `int?` counts as integral.
        if (type is INamedTypeSymbol { OriginalDefinition.SpecialType: SpecialType.System_Nullable_T } n
            && n.TypeArguments.Length == 1)
            type = n.TypeArguments[0];

        switch (type.SpecialType)
        {
            case SpecialType.System_String:
            case SpecialType.System_Char:
            case SpecialType.System_SByte:
            case SpecialType.System_Byte:
            case SpecialType.System_Int16:
            case SpecialType.System_UInt16:
            case SpecialType.System_Int32:
            case SpecialType.System_UInt32:
            case SpecialType.System_Int64:
            case SpecialType.System_UInt64:
                return true;
        }

        // An unbound type parameter (`this[TKey key]`) is generic by design — the
        // consumer chooses the key type, so we can't call it non-standard.
        if (type.TypeKind == TypeKind.TypeParameter) return true;

        // System.Index / System.Range are the BCL's own indexer key types.
        var ns = type.ContainingNamespace?.ToDisplayString();
        if (ns == "System" && type.Name is "Index" or "Range") return true;

        return false;
    }
}
