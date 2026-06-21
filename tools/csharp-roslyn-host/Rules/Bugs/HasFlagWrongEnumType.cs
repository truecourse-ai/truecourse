using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `Enum.HasFlag(arg)` where the argument's enum type differs from the receiver's.
/// A flag from a different enum can never be present, and the BCL throws
/// ArgumentException at runtime — a logic error. Needs both the receiver and
/// argument resolved enum types. CA2248.
/// </summary>
internal sealed class HasFlagWrongEnumType : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/hasflag-wrong-enum-type";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.Text != "HasFlag") continue;
            if (inv.ArgumentList.Arguments.Count != 1) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            // System.Enum.HasFlag(Enum)
            if (m.Name != "HasFlag" || m.ContainingType?.SpecialType != SpecialType.System_Enum) continue;

            var recvType = model.GetTypeInfo(ma.Expression).Type;
            var argType = model.GetTypeInfo(inv.ArgumentList.Arguments[0].Expression).Type;
            if (recvType is not { TypeKind: TypeKind.Enum }) continue;
            if (argType is not { TypeKind: TypeKind.Enum }) continue;
            if (SymbolEqualityComparer.Default.Equals(recvType, argType)) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"HasFlag is called with a '{argType.Name}' flag on a '{recvType.Name}' value — the enum types differ, so this throws ArgumentException at runtime.");
        }
    }
}
