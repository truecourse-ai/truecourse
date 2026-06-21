using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A type or type member that declares no explicit access modifier, leaving its
/// accessibility implicit (internal for top-level types, private for members). Making
/// the modifier explicit removes the "is this public?" ambiguity at the declaration.
/// We flag only declarations where an access modifier is *legal and meaningful* —
/// interface members, explicit interface implementations, static constructors,
/// operators, partial members (covered by a separate rule), and enum members are
/// excluded. SA1400.
/// </summary>
internal sealed class MissingAccessModifier : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/missing-access-modifier";

    private static readonly string[] AccessModifiers = { "public", "private", "protected", "internal" };

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var node in tree.GetRoot().DescendantNodes())
        {
            if (node is not MemberDeclarationSyntax member) continue;
            if (!IsAccessModifierApplicable(member)) continue;
            if (HasExplicitAccessModifier(member.Modifiers)) continue;
            // `partial` declarations are governed by partial-element-missing-access-modifier.
            if (member.Modifiers.Any(m => m.IsKind(SyntaxKind.PartialKeyword))) continue;

            var (loc, label) = Target(member);
            if (loc is null) continue;
            var pos = loc.GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"{label} declares no explicit access modifier; add one to make its accessibility unambiguous.");
        }
    }

    private static bool HasExplicitAccessModifier(SyntaxTokenList modifiers) =>
        modifiers.Any(m => AccessModifiers.Contains(m.Text));

    private static bool IsAccessModifierApplicable(MemberDeclarationSyntax member)
    {
        // Members of an interface have implicit public access that cannot be changed.
        if (member.Parent is InterfaceDeclarationSyntax) return false;
        // Members of an enum (the enum constants) take no access modifier.
        if (member.Parent is EnumDeclarationSyntax) return false;

        switch (member)
        {
            case ClassDeclarationSyntax:
            case StructDeclarationSyntax:
            case InterfaceDeclarationSyntax:
            case RecordDeclarationSyntax:
            case EnumDeclarationSyntax:
            case DelegateDeclarationSyntax:
            case FieldDeclarationSyntax:
            case PropertyDeclarationSyntax:
            case EventDeclarationSyntax:
            case EventFieldDeclarationSyntax:
            case IndexerDeclarationSyntax:
                return true;

            case MethodDeclarationSyntax method:
                // Explicit interface implementations take no access modifier.
                return method.ExplicitInterfaceSpecifier is null;

            case ConstructorDeclarationSyntax ctor:
                // A static constructor never takes an access modifier.
                return !ctor.Modifiers.Any(m => m.IsKind(SyntaxKind.StaticKeyword));

            // Destructors, operators, conversion operators take no access modifier.
            default:
                return false;
        }
    }

    private static (Location?, string) Target(MemberDeclarationSyntax member) => member switch
    {
        BaseTypeDeclarationSyntax t => (t.Identifier.GetLocation(), $"Type '{t.Identifier.ValueText}'"),
        DelegateDeclarationSyntax d => (d.Identifier.GetLocation(), $"Delegate '{d.Identifier.ValueText}'"),
        MethodDeclarationSyntax m => (m.Identifier.GetLocation(), $"Method '{m.Identifier.ValueText}'"),
        PropertyDeclarationSyntax p => (p.Identifier.GetLocation(), $"Property '{p.Identifier.ValueText}'"),
        EventDeclarationSyntax e => (e.Identifier.GetLocation(), $"Event '{e.Identifier.ValueText}'"),
        IndexerDeclarationSyntax ix => (ix.ThisKeyword.GetLocation(), "Indexer"),
        ConstructorDeclarationSyntax c => (c.Identifier.GetLocation(), $"Constructor '{c.Identifier.ValueText}'"),
        FieldDeclarationSyntax f when f.Declaration.Variables.Count > 0
            => (f.Declaration.Variables[0].Identifier.GetLocation(), $"Field '{f.Declaration.Variables[0].Identifier.ValueText}'"),
        EventFieldDeclarationSyntax ef when ef.Declaration.Variables.Count > 0
            => (ef.Declaration.Variables[0].Identifier.GetLocation(), $"Event '{ef.Declaration.Variables[0].Identifier.ValueText}'"),
        _ => (null, ""),
    };
}
