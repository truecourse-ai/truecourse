using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A method attributed with a serialization-event callback ([OnSerializing], [OnSerialized],
/// [OnDeserializing], [OnDeserialized]) whose signature does not match what the runtime
/// requires: it must be an instance method returning void and taking a single StreamingContext
/// parameter. If the signature is wrong, the runtime never invokes the handler — silent
/// breakage. We resolve the attribute and inspect the method symbol's shape.
/// </summary>
internal sealed class SerializationHandlerWrongSignature : ISemanticRule
{
    private static readonly HashSet<string> CallbackAttrs = new(StringComparer.Ordinal)
    {
        "OnSerializingAttribute", "OnSerializedAttribute",
        "OnDeserializingAttribute", "OnDeserializedAttribute",
    };

    public string RuleKey => "bugs/deterministic/serialization-handler-wrong-signature";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(method) is not IMethodSymbol sym) continue;
            var attr = sym.GetAttributes().FirstOrDefault(a =>
                a.AttributeClass is { } c && CallbackAttrs.Contains(c.Name) &&
                c.ContainingNamespace?.ToDisplayString() == "System.Runtime.Serialization");
            if (attr is null) continue;

            var problems = new List<string>();
            if (sym.IsStatic) problems.Add("must not be static");
            if (sym.ReturnType.SpecialType != SpecialType.System_Void) problems.Add("must return void");
            if (sym.Parameters.Length != 1 || sym.Parameters[0].Type.Name != "StreamingContext")
                problems.Add("must take a single StreamingContext parameter");
            if (sym.IsGenericMethod) problems.Add("must not be generic");

            if (problems.Count == 0) continue;

            var pos = method.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Serialization callback '{sym.Name}' has the wrong signature ({string.Join("; ", problems)}) — the runtime will never call it.");
        }
    }
}
