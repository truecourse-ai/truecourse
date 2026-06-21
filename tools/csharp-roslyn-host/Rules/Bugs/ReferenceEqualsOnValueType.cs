using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `object.ReferenceEquals(a, b)` where an argument is a value type. Value types
/// are boxed into separate objects, so ReferenceEquals is always false — a real
/// bug pure syntax cannot catch (it needs the argument's resolved type). CA2013.
/// </summary>
internal sealed class ReferenceEqualsOnValueType : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/referenceequals-on-value-type";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.Name != "ReferenceEquals" || m.ContainingType?.SpecialType != SpecialType.System_Object) continue;

            foreach (var arg in inv.ArgumentList.Arguments)
            {
                var type = model.GetTypeInfo(arg.Expression).Type;
                if (type is { IsValueType: true } && type.SpecialType != SpecialType.System_Void)
                {
                    var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
                    yield return new Violation(
                        RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                        "object.ReferenceEquals on a value type is always false — the arguments are boxed into distinct objects.");
                    break;
                }
            }
        }
    }
}
