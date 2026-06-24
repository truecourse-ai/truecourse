using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A [Flags] enum member defined as a constant whose value sets a bit not backed by
/// any single-bit member of the enum. That bit references a flag that does not exist —
/// a typo or a removed member. We compute the union of all the enum's individual
/// (power-of-two and zero) member bits and flag any member whose value has bits
/// outside that union. Needs the resolved constant values of every member. RCS1157.
/// </summary>
internal sealed class EnumUndefinedCompositeFlag : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/enum-undefined-composite-flag";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var enumDecl in tree.GetRoot().DescendantNodes().OfType<EnumDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(enumDecl) is not INamedTypeSymbol enumSym) continue;
            if (!HasFlagsAttribute(enumSym)) continue;

            // Gather every member's constant value as an unsigned bit pattern.
            var members = new List<(string Name, ulong Value)>();
            foreach (var m in enumSym.GetMembers().OfType<IFieldSymbol>())
            {
                if (!m.HasConstantValue || m.ConstantValue is null) continue;
                members.Add((m.Name, ToBits(m.ConstantValue)));
            }
            if (members.Count == 0) continue;

            // The "defined bit space" = OR of members that are a single bit or zero.
            ulong known = 0;
            foreach (var (_, v) in members)
                if (v == 0 || IsSingleBit(v)) known |= v;

            foreach (var member in enumDecl.Members)
            {
                if (model.GetDeclaredSymbol(member) is not IFieldSymbol fSym) continue;
                if (!fSym.HasConstantValue || fSym.ConstantValue is null) continue;
                var bits = ToBits(fSym.ConstantValue);
                if (bits == 0 || IsSingleBit(bits)) continue;     // not a composite
                var stray = bits & ~known;
                if (stray == 0) continue;

                var pos = member.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Composite flag '{enumSym.Name}.{fSym.Name}' sets bit(s) (0x{stray:X}) not backed by any single-flag member — likely a typo or a removed member.");
            }
        }
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
