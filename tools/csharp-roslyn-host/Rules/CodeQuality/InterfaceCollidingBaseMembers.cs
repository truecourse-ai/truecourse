using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An interface that multiply-inherits two or more base interfaces which each declare
/// a member with the same name (and neither inherits the other). Accessing that name
/// through the derived interface is ambiguous and forces casts. Needs the resolved
/// base-interface set and their members. S3444.
/// </summary>
internal sealed class InterfaceCollidingBaseMembers : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/interface-colliding-base-members";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var ifaceDecl in tree.GetRoot().DescendantNodes().OfType<InterfaceDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(ifaceDecl) is not INamedTypeSymbol iface) continue;

            // Only the DIRECTLY-listed base interfaces matter for a fresh collision;
            // a name redeclared on the interface itself disambiguates and is fine.
            var directBases = iface.Interfaces;
            if (directBases.Length < 2) continue;

            var ownNames = new HashSet<string>(
                iface.GetMembers().Where(m => m.CanBeReferencedByName).Select(m => m.Name),
                StringComparer.Ordinal);

            // Map member name -> the distinct declaring base interfaces that expose it.
            var nameToBases = new Dictionary<string, HashSet<INamedTypeSymbol>>(StringComparer.Ordinal);
            foreach (var baseIface in directBases)
            {
                // Members visible through this base = its own + everything it inherits.
                var seen = new HashSet<string>(StringComparer.Ordinal);
                foreach (var m in MembersIncludingInherited(baseIface))
                {
                    if (!m.CanBeReferencedByName || string.IsNullOrEmpty(m.Name)) continue;
                    if (!seen.Add(m.Name)) continue;
                    if (!nameToBases.TryGetValue(m.Name, out var set))
                        nameToBases[m.Name] = set = new HashSet<INamedTypeSymbol>(SymbolEqualityComparer.Default);
                    set.Add(baseIface);
                }
            }

            foreach (var (name, bases) in nameToBases)
            {
                if (bases.Count < 2) continue;          // only one base supplies it — no clash
                if (ownNames.Contains(name)) continue;  // redeclared here — disambiguated
                // Exclude the case where one of the bases derives from the other (the
                // member is inherited, not independently declared) — not a real collision.
                if (OneDerivesFromAnother(bases)) continue;

                var pos = ifaceDecl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Interface '{iface.Name}' inherits a colliding member '{name}' from multiple base interfaces, making access ambiguous.");
            }
        }
    }

    private static IEnumerable<ISymbol> MembersIncludingInherited(INamedTypeSymbol iface)
    {
        foreach (var m in iface.GetMembers()) yield return m;
        foreach (var b in iface.AllInterfaces)
            foreach (var m in b.GetMembers()) yield return m;
    }

    private static bool OneDerivesFromAnother(HashSet<INamedTypeSymbol> bases)
    {
        foreach (var a in bases)
            foreach (var b in bases)
            {
                if (SymbolEqualityComparer.Default.Equals(a, b)) continue;
                if (a.AllInterfaces.Contains(b, SymbolEqualityComparer.Default)) return true;
            }
        return false;
    }
}
