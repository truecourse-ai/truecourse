using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `new TaskCompletionSource(...)` / `new TaskCompletionSource&lt;T&gt;(...)` passed a
/// `TaskContinuationOptions` value where the constructor expects `TaskCreationOptions`.
/// The TCS constructor has an `object state` overload, so the wrong enum binds to
/// `state` instead and is silently ignored — the intended creation options never take
/// effect. Needs the argument's resolved enum type and the bound constructor parameter.
/// CA2247.
/// </summary>
internal sealed class TaskCompletionSourceWrongOptions : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/taskcompletionsource-wrong-options";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var oc in tree.GetRoot().DescendantNodes().OfType<ObjectCreationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(oc).Symbol is not IMethodSymbol ctor) continue;
            var t = ctor.ContainingType?.OriginalDefinition;
            if (t is null || t.Name != "TaskCompletionSource" ||
                t.ContainingNamespace?.ToDisplayString() != "System.Threading.Tasks")
                continue;

            var args = oc.ArgumentList?.Arguments;
            if (args is not { Count: > 0 }) continue;

            foreach (var arg in args)
            {
                var type = model.GetTypeInfo(arg.Expression).Type;
                if (type is { TypeKind: TypeKind.Enum, Name: "TaskContinuationOptions" } &&
                    type.ContainingNamespace?.ToDisplayString() == "System.Threading.Tasks")
                {
                    var pos = oc.GetLocation().GetLineSpan().StartLinePosition;
                    yield return new Violation(
                        RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                        "TaskCompletionSource is constructed with a TaskContinuationOptions value where TaskCreationOptions is expected — it binds to the 'object state' overload and is silently ignored. Use TaskCreationOptions.");
                    break;
                }
            }
        }
    }
}
