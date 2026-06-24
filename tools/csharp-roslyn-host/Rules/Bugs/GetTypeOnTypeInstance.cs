using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `GetType()` invoked on a value whose static type is already System.Type. This
/// returns the runtime type of the Type object itself (RuntimeType), not the type
/// it represents — almost always a mistake. Needs the receiver's resolved type.
/// </summary>
internal sealed class GetTypeOnTypeInstance : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/gettype-on-type-instance";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.Text != "GetType") continue;
            if (inv.ArgumentList.Arguments.Count != 0) continue;

            // Bind the call to the parameterless object.GetType(). Roslyn reports the
            // binding's ContainingType as the static receiver type (System.Type here),
            // not System.Object, so we identify the method by its shape — zero params,
            // returns System.Type — rather than by containing type.
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.Name != "GetType" || m.Parameters.Length != 0) continue;
            if (!IsSystemType(m.ReturnType)) continue;

            // The receiver's STATIC type must be System.Type (or a subtype like
            // RuntimeType). typeof(...) and Type-typed variables are the bug shape.
            var recv = model.GetTypeInfo(ma.Expression).Type;
            if (recv is null || !IsSystemType(recv)) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "GetType() is called on a value already of type System.Type — this returns RuntimeType, not the type it represents. Use the Type instance directly.");
        }
    }

    private static bool IsSystemType(ITypeSymbol type)
    {
        for (var t = type; t is not null; t = t.BaseType)
            if (t is { Name: "Type", ContainingNamespace: { Name: "System", ContainingNamespace.IsGlobalNamespace: true } })
                return true;
        return false;
    }
}
