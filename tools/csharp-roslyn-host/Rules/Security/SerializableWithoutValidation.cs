using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A <c>[Serializable]</c> type whose <c>ISerializable</c> deserialization constructor
/// rebuilds the object without the validation its ordinary constructors enforce (S5766).
/// If a normal constructor guards its inputs (throws, or calls an <c>ArgumentException
/// .ThrowIf*</c> helper) but the <c>(SerializationInfo, StreamingContext)</c> constructor
/// just copies fields out of the stream, a tampered payload resurrects an object the
/// normal path would have rejected, bypassing the type's invariants. Kept false-positive
/// free: the deserialization constructor is flagged only when it contains no throw, no
/// branch, and no call other than reads off the <c>SerializationInfo</c> — so a
/// constructor that validates by any means (a guard, a helper, a shared Validate call)
/// is never misread as unguarded.
/// </summary>
internal sealed class SerializableWithoutValidation : ISemanticRule
{
    private const string SerializationInfoType = "System.Runtime.Serialization.SerializationInfo";
    private const string StreamingContextType = "System.Runtime.Serialization.StreamingContext";

    public string RuleKey => "security/deterministic/serializable-without-validation";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var type in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (type is not (ClassDeclarationSyntax or StructDeclarationSyntax)) continue;
            if (model.GetDeclaredSymbol(type) is not INamedTypeSymbol sym) continue;
            if (!sym.GetAttributes().Any(a => a.AttributeClass?.ToDisplayString() == "System.SerializableAttribute")) continue;

            var ctors = type.Members.OfType<ConstructorDeclarationSyntax>().ToList();
            var deserCtor = ctors.FirstOrDefault(c => IsDeserializationCtor(c, model));
            if (deserCtor is null) continue;

            if (!ctors.Any(c => c != deserCtor && Validates(c))) continue;
            if (Validates(deserCtor) || ContainsBranch(deserCtor) || !OnlyReadsSerializationInfo(deserCtor, model)) continue;

            var pos = deserCtor.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"The deserialization constructor of '{sym.Name}' rebuilds the object without the validation its other constructors enforce, so a tampered serialized payload bypasses those invariants.");
        }
    }

    private static bool IsDeserializationCtor(ConstructorDeclarationSyntax ctor, SemanticModel model)
    {
        if (model.GetDeclaredSymbol(ctor) is not IMethodSymbol m || m.Parameters.Length != 2) return false;
        return m.Parameters[0].Type.ToDisplayString() == SerializationInfoType
            && m.Parameters[1].Type.ToDisplayString() == StreamingContextType;
    }

    // Validation = a throw, or an ArgumentException-style ThrowIf* guard helper.
    private static bool Validates(ConstructorDeclarationSyntax ctor) =>
        ctor.DescendantNodes().Any(n =>
            n is ThrowStatementSyntax or ThrowExpressionSyntax ||
            (n is InvocationExpressionSyntax inv &&
             inv.Expression is MemberAccessExpressionSyntax ma &&
             ma.Name.Identifier.ValueText.StartsWith("ThrowIf", System.StringComparison.Ordinal)));

    private static bool ContainsBranch(ConstructorDeclarationSyntax ctor) =>
        ctor.DescendantNodes().Any(n =>
            n is IfStatementSyntax or SwitchStatementSyntax or SwitchExpressionSyntax or ConditionalExpressionSyntax);

    // True when every call in the body is either nameof(...) or a member read off the
    // SerializationInfo argument — i.e. the constructor does no work that could validate.
    private static bool OnlyReadsSerializationInfo(ConstructorDeclarationSyntax ctor, SemanticModel model)
    {
        foreach (var inv in ctor.DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is IdentifierNameSyntax { Identifier.ValueText: "nameof" }) continue;
            var target = model.GetSymbolInfo(inv).Symbol as IMethodSymbol;
            if (target?.ContainingType?.ToDisplayString() == SerializationInfoType) continue;
            return false;
        }
        return true;
    }
}
