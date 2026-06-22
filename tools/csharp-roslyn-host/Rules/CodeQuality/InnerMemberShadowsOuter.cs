using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A nested type's member whose name matches a `static` member of the enclosing
/// type. Inside the nested type the name resolves to the nested member, silently
/// hiding the outer static — a confusing surprise for readers who expect the outer
/// one. Needs symbol resolution to enumerate the enclosing type's static members and
/// compare against the nested type's declared members.
/// </summary>
internal sealed class InnerMemberShadowsOuter : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/inner-member-shadows-outer";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var nested in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(nested) is not INamedTypeSymbol nestedSym) continue;
            // Only types actually nested inside another type can shadow an outer member.
            if (nestedSym.ContainingType is not { } outer) continue;

            // Collect static member names of the enclosing type (and its bases), which
            // are the names visible unqualified inside the nested type.
            var outerStatics = new HashSet<string>(StringComparer.Ordinal);
            for (var t = outer; t is not null; t = t.BaseType)
            {
                foreach (var m in t.GetMembers())
                {
                    if (!m.IsStatic) continue;
                    if (m.Kind is SymbolKind.NamedType) continue; // nested types handled separately
                    if (string.IsNullOrEmpty(m.Name) || !m.CanBeReferencedByName) continue;
                    outerStatics.Add(m.Name);
                }
            }
            if (outerStatics.Count == 0) continue;

            foreach (var memberNode in DeclaredMemberIdentifiers(nested))
            {
                if (!outerStatics.Contains(memberNode.ValueText)) continue;
                var pos = memberNode.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Member '{memberNode.ValueText}' on nested type '{nestedSym.Name}' shadows a static member of the enclosing type '{outer.Name}'; rename it.");
            }
        }
    }

    /// Identifier tokens of the nested type's own named members (fields, properties,
    /// methods, events, nested types). Used to detect name collisions.
    private static IEnumerable<SyntaxToken> DeclaredMemberIdentifiers(TypeDeclarationSyntax nested)
    {
        foreach (var member in nested.Members)
        {
            switch (member)
            {
                case FieldDeclarationSyntax f:
                    foreach (var v in f.Declaration.Variables) yield return v.Identifier;
                    break;
                case PropertyDeclarationSyntax p:
                    yield return p.Identifier;
                    break;
                case MethodDeclarationSyntax m:
                    yield return m.Identifier;
                    break;
                case EventDeclarationSyntax e:
                    yield return e.Identifier;
                    break;
                case EventFieldDeclarationSyntax ef:
                    foreach (var v in ef.Declaration.Variables) yield return v.Identifier;
                    break;
                case TypeDeclarationSyntax t:
                    yield return t.Identifier;
                    break;
            }
        }
    }
}
