using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A type implements ISerializable but is missing a required serialization member: the
/// `GetObjectData(SerializationInfo, StreamingContext)` method, and/or the deserialization
/// constructor `(SerializationInfo, StreamingContext)`. Without both, the type does not
/// round-trip through BinaryFormatter-style serialization. We confirm the interface is
/// implemented and look for the two members via the semantic model. S3925/CA2229/CA2237.
/// </summary>
internal sealed class ISerializableIncorrect : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/iserializable-incorrect";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (typeDecl is not (ClassDeclarationSyntax or StructDeclarationSyntax)) continue;
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol type) continue;
            if (type.IsAbstract) continue;

            // Must implement ISerializable directly (not merely inherit a base that already
            // handles it, which is correct).
            if (!type.Interfaces.Any(IsISerializable)) continue;

            bool hasGetObjectData = type.GetMembers("GetObjectData").OfType<IMethodSymbol>()
                .Any(m => IsSerializationSignature(m));
            bool hasDeserializationCtor = type.InstanceConstructors
                .Any(c => IsSerializationSignature(c));

            if (hasGetObjectData && hasDeserializationCtor) continue;

            var missing = (hasGetObjectData, hasDeserializationCtor) switch
            {
                (false, false) => "GetObjectData(SerializationInfo, StreamingContext) and the (SerializationInfo, StreamingContext) deserialization constructor",
                (false, true) => "the GetObjectData(SerializationInfo, StreamingContext) method",
                (true, false) => "the (SerializationInfo, StreamingContext) deserialization constructor",
                _ => "",
            };

            var pos = typeDecl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{type.Name}' implements ISerializable but is missing {missing} — it will not round-trip through serialization.");
        }
    }

    private static bool IsISerializable(INamedTypeSymbol i) =>
        i.Name == "ISerializable" && i.ContainingNamespace?.ToDisplayString() == "System.Runtime.Serialization";

    private static bool IsSerializationSignature(IMethodSymbol m) =>
        m.Parameters.Length == 2 &&
        m.Parameters[0].Type.Name == "SerializationInfo" &&
        m.Parameters[1].Type.Name == "StreamingContext";
}
