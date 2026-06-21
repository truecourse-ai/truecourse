using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An enum marked [Flags] whose members are NOT bit-combinable: they rely on default
/// sequential values (0, 1, 2, 3, 4, ...) so OR-ing them produces overlapping,
/// meaningless results. A genuine flags enum assigns distinct powers of two. We flag a
/// [Flags] enum when a member that is NOT declared as an explicit bitwise combination
/// (e.g. `All = A | B`) nevertheless has a non-zero value that is not a single bit —
/// the hallmark of the sequential default. Members whose initializer is a `|`/`+`
/// combination of other flags are intentional and exempt. Needs resolved member
/// constant values plus the initializer syntax. S4070.
/// </summary>
internal sealed class NonFlagsEnumWithFlagsAttribute : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/non-flags-enum-with-flags-attribute";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var enumDecl in tree.GetRoot().DescendantNodes().OfType<EnumDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(enumDecl) is not INamedTypeSymbol enumSym) continue;
            if (!HasFlagsAttribute(enumSym)) continue;
            if (enumDecl.Members.Count < 2) continue;

            // A member is "atomic" unless its initializer explicitly combines flags. An
            // atomic non-zero member that is not a single power of two means the enum is
            // using sequential numbering rather than distinct bit values.
            bool sequential = false;
            foreach (var member in enumDecl.Members)
            {
                if (model.GetDeclaredSymbol(member) is not IFieldSymbol f) continue;
                if (!f.HasConstantValue || f.ConstantValue is null) continue;
                var v = ToBits(f.ConstantValue);
                if (v == 0 || IsSingleBit(v)) continue;        // 0 and powers of two are fine
                if (IsExplicitCombination(member.EqualsValue?.Value)) continue;  // `All = A | B`
                sequential = true;
                break;
            }
            if (!sequential) continue;

            var pos = enumDecl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Enum '{enumSym.Name}' is marked [Flags] but its members are not bit-combinable values, so OR-ing them is meaningless. Assign distinct powers of two or remove [Flags].");
        }
    }

    // True when the initializer combines flags explicitly (OR / addition of named flags),
    // which is the legitimate "aggregate" shape and not a sequential-default value.
    private static bool IsExplicitCombination(ExpressionSyntax? expr)
    {
        var e = expr;
        while (e is ParenthesizedExpressionSyntax p) e = p.Expression;
        return e is BinaryExpressionSyntax b &&
               (b.IsKind(Microsoft.CodeAnalysis.CSharp.SyntaxKind.BitwiseOrExpression) ||
                b.IsKind(Microsoft.CodeAnalysis.CSharp.SyntaxKind.AddExpression));
    }

    private static bool IsSingleBit(ulong v) => v != 0 && (v & (v - 1)) == 0;

    private static ulong ToBits(object v) => v switch
    {
        sbyte x => unchecked((ulong)(byte)x),
        byte x => x,
        short x => unchecked((ulong)(ushort)x),
        ushort x => x,
        int x => unchecked((ulong)(uint)x),
        uint x => x,
        long x => unchecked((ulong)x),
        ulong x => x,
        _ => 0,
    };

    private static bool HasFlagsAttribute(INamedTypeSymbol type) =>
        type.GetAttributes().Any(a => a.AttributeClass is
        {
            Name: "FlagsAttribute",
            ContainingNamespace: { Name: "System", ContainingNamespace.IsGlobalNamespace: true },
        });
}
