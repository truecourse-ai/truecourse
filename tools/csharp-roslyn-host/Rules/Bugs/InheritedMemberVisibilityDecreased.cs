using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A derived member hides a base member of the same signature (`new`, or an implicit hide)
/// but with NARROWER accessibility — e.g. a `protected` method named like a `public` base
/// method. Callers holding a base reference still see the wider access, so the substitution
/// contract is broken and which body runs depends on the static type. We resolve the hidden
/// base member through the type chain and compare accessibility, which needs the semantic
/// model. S4015.
/// </summary>
internal sealed class InheritedMemberVisibilityDecreased : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/inherited-member-visibility-decreased";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var member in tree.GetRoot().DescendantNodes().OfType<MemberDeclarationSyntax>())
        {
            if (member is not (MethodDeclarationSyntax or PropertyDeclarationSyntax)) continue;

            var mods = member.Modifiers;
            // Overrides keep the base accessibility (compiler-enforced); skip them. Only an
            // implicit hide or `new` member can narrow access.
            if (mods.Any(SyntaxKind.OverrideKeyword)) continue;

            if (model.GetDeclaredSymbol(member) is not ISymbol sym) continue;
            if (sym.ContainingType is not { TypeKind: TypeKind.Class } type) continue;
            if (sym.IsStatic) continue;

            ISymbol? hidden = FindHidden(type, sym);
            if (hidden is null) continue;
            if (hidden.DeclaredAccessibility == Accessibility.Private) continue;

            if (Rank(sym.DeclaredAccessibility) >= Rank(hidden.DeclaredAccessibility)) continue;

            var idLoc = member switch
            {
                MethodDeclarationSyntax md => md.Identifier.GetLocation(),
                PropertyDeclarationSyntax pd => pd.Identifier.GetLocation(),
                _ => member.GetLocation(),
            };
            var pos = idLoc.GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{sym.Name}' reduces the visibility of inherited '{hidden.ContainingType.Name}.{sym.Name}' ({hidden.DeclaredAccessibility} -> {sym.DeclaredAccessibility}) — base-typed callers still see the wider access, breaking substitutability.");
        }
    }

    private static ISymbol? FindHidden(INamedTypeSymbol type, ISymbol sym)
    {
        for (var b = type.BaseType; b is not null && b.SpecialType != SpecialType.System_Object; b = b.BaseType)
        {
            foreach (var cand in b.GetMembers(sym.Name))
            {
                if (cand.IsStatic) continue;
                if (sym is IMethodSymbol sm && cand is IMethodSymbol bm &&
                    bm.MethodKind == MethodKind.Ordinary && SignatureMatches(bm, sm))
                    return bm;
                if (sym is IPropertySymbol && cand is IPropertySymbol bp && bp.Parameters.Length == 0)
                    return bp;
            }
        }
        return null;
    }

    // object > internal/protected family > private. Higher rank = more accessible.
    private static int Rank(Accessibility a) => a switch
    {
        Accessibility.Public => 5,
        Accessibility.ProtectedOrInternal => 4,
        Accessibility.Internal or Accessibility.Protected => 3,
        Accessibility.ProtectedAndInternal => 2,
        Accessibility.Private => 1,
        _ => 0,
    };

    private static bool SignatureMatches(IMethodSymbol a, IMethodSymbol b)
    {
        if (a.Parameters.Length != b.Parameters.Length || a.Arity != b.Arity) return false;
        for (var i = 0; i < a.Parameters.Length; i++)
        {
            if (a.Parameters[i].RefKind != b.Parameters[i].RefKind) return false;
            if (!SymbolEqualityComparer.Default.Equals(a.Parameters[i].Type, b.Parameters[i].Type)) return false;
        }
        return true;
    }
}
