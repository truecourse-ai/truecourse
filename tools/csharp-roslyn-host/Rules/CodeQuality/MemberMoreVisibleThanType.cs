using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A `public` member declared on a `private`/`protected` nested type, where the
/// member can never be reached through the type — the broader modifier is dead and
/// misleading. Restricted to genuinely-capped types: an `internal` type's public
/// member is still reachable across the assembly (and via InternalsVisibleTo), so
/// `public` there carries real meaning and is NOT flagged. Needs the resolved
/// declared accessibility of both member and type (which folds in containment).
/// </summary>
internal sealed class MemberMoreVisibleThanType : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/member-more-visible-than-type";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol type) continue;
            // Only a nested type whose own accessibility is private/protected truly caps
            // its members: nobody outside the enclosing type can reach them, so `public`
            // is dead. An `internal` type's members stay reachable across the assembly, so
            // public there is meaningful and must not be flagged.
            if (type.DeclaredAccessibility is not (Accessibility.Private or Accessibility.Protected
                or Accessibility.ProtectedOrInternal or Accessibility.ProtectedAndInternal)) continue;

            // If any base type/interface can't be resolved — common when a nested type
            // implements an external framework interface (e.g. a Razor SDK feature) that
            // the loose-text host has no reference for — we cannot enumerate the type's
            // contract surface, so we cannot prove a public member is dead. An implicit
            // implementation of such an interface MUST be public; flagging it is a false
            // positive. Be conservative and skip the whole type.
            if (HasUnresolvedBaseType(typeDecl, model)) continue;

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
                    // Implicit interface implementations MUST be public to satisfy the
                    // contract — the modifier is required, not misleading. (Explicit ones
                    // are handled above.)
                    if (ImplementsInterfaceMember(member, type)) continue;

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

    /// <summary>
    /// True when any entry in the type's base list fails to resolve to a known type
    /// (a null or error symbol). In loose-text analysis this happens whenever a type
    /// derives from / implements something defined in an unreferenced assembly, so the
    /// type's full interface set is unknown and deadness of a public member can't be proven.
    /// </summary>
    private static bool HasUnresolvedBaseType(TypeDeclarationSyntax typeDecl, SemanticModel model)
    {
        if (typeDecl.BaseList is null) return false;
        foreach (var baseType in typeDecl.BaseList.Types)
        {
            var sym = model.GetTypeInfo(baseType.Type).Type;
            if (sym is null || sym.TypeKind == TypeKind.Error) return true;
        }
        return false;
    }

    /// <summary>
    /// True when <paramref name="member"/> is the implicit implementation of an
    /// interface member on <paramref name="type"/>. Such a member is forced to be
    /// public by the language, so a `public` modifier there is mandated rather than
    /// a dead/misleading widening. (Explicit implementations are filtered earlier.)
    /// </summary>
    private static bool ImplementsInterfaceMember(ISymbol member, INamedTypeSymbol type)
    {
        foreach (var iface in type.AllInterfaces)
        {
            foreach (var ifaceMember in iface.GetMembers())
            {
                var impl = type.FindImplementationForInterfaceMember(ifaceMember);
                if (impl is not null && SymbolEqualityComparer.Default.Equals(impl, member))
                    return true;
            }
        }
        return false;
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
