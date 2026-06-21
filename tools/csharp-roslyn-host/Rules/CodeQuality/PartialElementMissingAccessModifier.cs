using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A `partial` type (or partial method) declaration that omits an explicit access
/// modifier. Because the accessibility may be stated in a *different* part of the
/// partial, this declaration on its own reads as having unknown accessibility. We flag
/// the partial declaration that carries no access modifier — even if another part
/// does — so each part is self-documenting. SA1205.
/// </summary>
internal sealed class PartialElementMissingAccessModifier : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/partial-element-missing-access-modifier";

    private static readonly string[] AccessModifiers = { "public", "private", "protected", "internal" };

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var node in tree.GetRoot().DescendantNodes())
        {
            if (node is not MemberDeclarationSyntax member) continue;
            if (!member.Modifiers.Any(m => m.IsKind(SyntaxKind.PartialKeyword))) continue;
            // Nested partial types inside an interface inherit implicit public; skip.
            if (member.Parent is InterfaceDeclarationSyntax) continue;
            if (HasExplicitAccessModifier(member.Modifiers)) continue;

            var (loc, label) = Target(member);
            if (loc is null) continue;
            var pos = loc.GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Partial {label} declares no access modifier here, hiding its accessibility in another part; state it explicitly on every part.");
        }
    }

    private static bool HasExplicitAccessModifier(SyntaxTokenList modifiers) =>
        modifiers.Any(m => AccessModifiers.Contains(m.Text));

    private static (Location?, string) Target(MemberDeclarationSyntax member) => member switch
    {
        BaseTypeDeclarationSyntax t => (t.Identifier.GetLocation(), $"type '{t.Identifier.ValueText}'"),
        MethodDeclarationSyntax m when m.ExplicitInterfaceSpecifier is null
            => (m.Identifier.GetLocation(), $"method '{m.Identifier.ValueText}'"),
        _ => (null, ""),
    };
}
