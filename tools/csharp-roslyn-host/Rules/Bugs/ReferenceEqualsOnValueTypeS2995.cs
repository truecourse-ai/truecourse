using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `object.ReferenceEquals(a, b)` where a value-type operand is present. Both operands
/// are boxed into distinct objects, so the call always returns false even for equal
/// values. This is the SonarLint S2995 variant (a sibling of CA2013); it fires on the
/// same hazard but is a distinct catalog rule. Needs the operand's resolved type.
/// S2995.
/// </summary>
internal sealed class ReferenceEqualsOnValueTypeS2995 : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/reference-equals-on-value-type";

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
                        "object.ReferenceEquals on a value type always returns false — the operands are boxed into distinct objects. Use == or Equals.");
                    break;
                }
            }
        }
    }
}
