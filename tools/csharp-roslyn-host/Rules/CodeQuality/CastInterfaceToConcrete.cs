using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An explicit cast (or `as`) from an interface-typed expression down to a concrete
/// class/struct that implements it. Downcasting past the abstraction couples the
/// caller to a specific implementation and defeats the point of the interface.
/// Needs both the source's static type (an interface) and the target type's kind.
/// S3215.
/// </summary>
internal sealed class CastInterfaceToConcrete : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/cast-interface-to-concrete";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var node in tree.GetRoot().DescendantNodes())
        {
            ExpressionSyntax operand;
            ITypeSymbol? targetType;

            switch (node)
            {
                case CastExpressionSyntax cast:
                    operand = cast.Expression;
                    targetType = model.GetTypeInfo(cast.Type).Type;
                    break;
                case BinaryExpressionSyntax bin when bin.OperatorToken.Text == "as":
                    operand = bin.Left;
                    targetType = model.GetTypeInfo(bin.Right).Type;
                    break;
                default:
                    continue;
            }

            if (targetType is not { TypeKind: TypeKind.Class or TypeKind.Struct }) continue;
            // Object isn't a meaningful concrete narrowing target here.
            if (targetType.SpecialType == SpecialType.System_Object) continue;

            var sourceType = model.GetTypeInfo(operand).Type;
            if (sourceType is not { TypeKind: TypeKind.Interface }) continue;

            // The concrete target must actually implement the source interface, i.e.
            // this is a downcast along the hierarchy, not an unrelated cross-cast.
            if (!targetType.AllInterfaces.Any(i => SymbolEqualityComparer.Default.Equals(i, sourceType)))
                continue;

            var pos = node.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Casting interface '{sourceType.Name}' down to concrete type '{targetType.Name}' defeats the abstraction; depend on the interface instead.");
        }
    }
}
