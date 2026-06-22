using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A user-defined operator overload with no corresponding named method (e.g.
/// `op_Addition` without an `Add` method). Languages that do not support operator
/// overloading can only call the named form, so omitting it makes the operation
/// unreachable for them. Needs the type's full member set. CA2225.
/// </summary>
internal sealed class OperatorWithoutNamedAlternative : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/operator-without-named-alternative";

    // Operator metadata name -> the conventional named alternative(s) (CA2225 map).
    private static readonly Dictionary<string, string[]> Named = new()
    {
        ["op_Addition"] = new[] { "Add" },
        ["op_Subtraction"] = new[] { "Subtract" },
        ["op_Multiply"] = new[] { "Multiply" },
        ["op_Division"] = new[] { "Divide" },
        ["op_Modulus"] = new[] { "Mod", "Remainder" },
        ["op_BitwiseAnd"] = new[] { "BitwiseAnd" },
        ["op_BitwiseOr"] = new[] { "BitwiseOr" },
        ["op_ExclusiveOr"] = new[] { "Xor" },
        ["op_LeftShift"] = new[] { "LeftShift" },
        ["op_RightShift"] = new[] { "RightShift" },
        ["op_OnesComplement"] = new[] { "OnesComplement" },
        ["op_UnaryNegation"] = new[] { "Negate" },
        ["op_UnaryPlus"] = new[] { "Plus" },
        ["op_LogicalNot"] = new[] { "LogicalNot" },
        ["op_Increment"] = new[] { "Increment" },
        ["op_Decrement"] = new[] { "Decrement" },
    };

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var opDecl in tree.GetRoot().DescendantNodes().OfType<OperatorDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(opDecl) is not IMethodSymbol op) continue;
            if (op.MethodKind != MethodKind.UserDefinedOperator) continue;
            if (!Named.TryGetValue(op.Name, out var alternatives)) continue;

            var type = op.ContainingType;
            if (type is null) continue;

            // A named alternative method (any accessibility, any signature) suffices.
            var hasNamed = type.GetMembers()
                .OfType<IMethodSymbol>()
                .Any(m => m.MethodKind == MethodKind.Ordinary && alternatives.Contains(m.Name));
            if (hasNamed) continue;

            var pos = opDecl.OperatorToken.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Operator '{opDecl.OperatorToken.Text}' on '{type.Name}' has no named alternative ('{alternatives[0]}'); languages without operator overloading cannot call it.");
        }
    }
}
