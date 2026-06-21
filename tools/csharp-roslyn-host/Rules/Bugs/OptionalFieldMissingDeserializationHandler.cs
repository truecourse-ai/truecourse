using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A type with an `[OptionalField]` member but no `[OnDeserialized]` or
/// `[OnDeserializing]` method to initialize it. When deserializing data written by an
/// older version that lacked the field, it is left at its default value with no chance
/// to set a sensible one. We scan the type for any [OptionalField] field and the
/// presence of a deserialization callback. Needs the resolved attributes on members.
/// S3926.
/// </summary>
internal sealed class OptionalFieldMissingDeserializationHandler : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/optionalfield-missing-deserialization-handler";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (typeDecl is not (ClassDeclarationSyntax or StructDeclarationSyntax)) continue;
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol type) continue;

            var fields = type.GetMembers().OfType<IFieldSymbol>().ToList();
            if (!fields.Any(f => HasAttr(f, "OptionalFieldAttribute"))) continue;

            bool hasHandler = type.GetMembers().OfType<IMethodSymbol>().Any(m =>
                HasAttr(m, "OnDeserializedAttribute") || HasAttr(m, "OnDeserializingAttribute"));
            if (hasHandler) continue;

            var pos = typeDecl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{type.Name}' has an [OptionalField] member but no [OnDeserialized]/[OnDeserializing] method — deserializing old data leaves the field at its default. Add a deserialization callback.");
        }
    }

    private static bool HasAttr(ISymbol s, string attrName) =>
        s.GetAttributes().Any(a => a.AttributeClass is { } c && c.Name == attrName &&
            c.ContainingNamespace.ToDisplayString() == "System.Runtime.Serialization");
}
