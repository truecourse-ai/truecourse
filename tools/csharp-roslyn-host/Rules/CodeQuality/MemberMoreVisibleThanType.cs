using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A `public` member declared on an `internal`/`private` type. The effective
/// accessibility is capped by the containing type, so the broader modifier is
/// misleading — readers think the member is part of the public surface when it
/// cannot be. Needs the resolved declared accessibility of both member and type
/// (which folds in containment). S3059.
/// </summary>
internal sealed class MemberMoreVisibleThanType : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/member-more-visible-than-type";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol type) continue;
            // Only when the declared accessibility of the TYPE is below public.
            if (type.DeclaredAccessibility is Accessibility.Public) continue;
            // Protected members of a public-base context are legitimately public-ish; we
            // restrict to internal/private/file-scoped types where public truly can't escape.
            if (type.DeclaredAccessibility is not (Accessibility.Internal or Accessibility.Private
                or Accessibility.ProtectedAndInternal)) continue;

            foreach (var memberNode in typeDecl.Members)
            {
                foreach (var member in DeclaredMembers(memberNode, model))
                {
                    if (member is null) continue;
                    // Flag only an explicitly broader-than-type accessibility. Interface
                    // members default to public but that is intentional; skip if the
                    // member belongs to an interface.
                    if (type.TypeKind == TypeKind.Interface) continue;
                    if (member.DeclaredAccessibility != Accessibility.Public) continue;
                    // Explicit interface implementations have no access modifier; skip.
                    if (member is IMethodSymbol { ExplicitInterfaceImplementations.Length: > 0 }) continue;

                    if (!HasExplicitPublicModifier(memberNode)) continue;

                    var loc = MemberIdentifier(memberNode);
                    var pos = loc.GetLineSpan().StartLinePosition;
                    yield return new Violation(
                        RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                        $"'{member.Name}' is declared public on the {Describe(type.DeclaredAccessibility)} type '{type.Name}'; the public modifier is misleading and has no wider effect.");
                }
            }
        }
    }

    private static IEnumerable<ISymbol?> DeclaredMembers(MemberDeclarationSyntax node, SemanticModel model)
    {
        switch (node)
        {
            case FieldDeclarationSyntax f:
                foreach (var v in f.Declaration.Variables) yield return model.GetDeclaredSymbol(v);
                break;
            case EventFieldDeclarationSyntax e:
                foreach (var v in e.Declaration.Variables) yield return model.GetDeclaredSymbol(v);
                break;
            default:
                yield return model.GetDeclaredSymbol(node);
                break;
        }
    }

    private static bool HasExplicitPublicModifier(MemberDeclarationSyntax node) =>
        node.Modifiers.Any(m => m.Text == "public");

    private static Location MemberIdentifier(MemberDeclarationSyntax node) => node switch
    {
        MethodDeclarationSyntax m => m.Identifier.GetLocation(),
        PropertyDeclarationSyntax p => p.Identifier.GetLocation(),
        FieldDeclarationSyntax f => f.Declaration.Variables[0].Identifier.GetLocation(),
        EventFieldDeclarationSyntax e => e.Declaration.Variables[0].Identifier.GetLocation(),
        EventDeclarationSyntax ev => ev.Identifier.GetLocation(),
        BaseTypeDeclarationSyntax t => t.Identifier.GetLocation(),
        _ => node.GetLocation(),
    };

    private static string Describe(Accessibility a) => a switch
    {
        Accessibility.Internal => "internal",
        Accessibility.Private => "private",
        Accessibility.ProtectedAndInternal => "private protected",
        _ => a.ToString().ToLowerInvariant(),
    };
}
