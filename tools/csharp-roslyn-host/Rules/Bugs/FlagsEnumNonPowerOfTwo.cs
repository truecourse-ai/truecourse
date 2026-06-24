using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A [Flags] enum member whose explicit value is neither zero, a single power of two,
/// nor a combination of other declared single-bit members. Such a value overlaps other
/// flags unexpectedly, so masking/testing produces wrong results. We allow composite
/// members that are exactly the OR of known single-bit members; anything with stray
/// bits OR a non-bit value is flagged. Needs resolved constant values. CA2217.
/// </summary>
internal sealed class FlagsEnumNonPowerOfTwo : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/flags-enum-non-power-of-two";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var enumDecl in tree.GetRoot().DescendantNodes().OfType<EnumDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(enumDecl) is not INamedTypeSymbol enumSym) continue;
            if (!HasFlagsAttribute(enumSym)) continue;

            // First pass: the set of single-bit member values.
            ulong knownBits = 0;
            foreach (var f in enumSym.GetMembers().OfType<IFieldSymbol>())
            {
                if (!f.HasConstantValue || f.ConstantValue is null) continue;
                var v = ToBits(f.ConstantValue);
                if (IsSingleBit(v)) knownBits |= v;
            }

            foreach (var member in enumDecl.Members)
            {
                if (model.GetDeclaredSymbol(member) is not IFieldSymbol fSym) continue;
                if (!fSym.HasConstantValue || fSym.ConstantValue is null) continue;
                var v = ToBits(fSym.ConstantValue);

                if (v == 0) continue;                 // zero "None" is fine
                if (IsSingleBit(v)) continue;          // a power of two is fine
                // A combination made only of known flag bits is intentional (e.g. All = R|W).
                if ((v & ~knownBits) == 0) continue;

                var pos = member.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"[Flags] member '{enumSym.Name}.{fSym.Name}' = {Display(fSym.ConstantValue)} is neither a power of two nor a combination of declared flags — flag tests on it will misbehave. Use distinct bit values.");
            }
        }
    }

    private static bool IsSingleBit(ulong v) => v != 0 && (v & (v - 1)) == 0;

    private static string Display(object v) => v?.ToString() ?? "?";

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
