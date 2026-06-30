using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An interface that multiply-inherits two or more base interfaces which each
/// independently declare a member with the exact same signature (name + parameter
/// types). Accessing such a member through the derived interface is ambiguous and
/// forces casts. Needs the resolved base-interface set and their members.
///
/// Two patterns are intentionally excluded:
/// - Diamond inheritance: a single member declaration reached via multiple paths
///   (same ContainingType for every copy) → not a genuine conflict.
/// - Method overloads: same name but different parameter-type signatures → separate
///   entries, each with one origin → not a conflict.
/// </summary>
internal sealed class InterfaceCollidingBaseMembers : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/interface-colliding-base-members";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var ifaceDecl in tree.GetRoot().DescendantNodes().OfType<InterfaceDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(ifaceDecl) is not INamedTypeSymbol iface) continue;

            var directBases = iface.Interfaces;
            if (directBases.Length < 2) continue;

            // Members redeclared on this interface itself disambiguate — skip them.
            var ownSignatures = new HashSet<string>(
                iface.GetMembers().Where(m => m.CanBeReferencedByName).Select(MemberSignature),
                StringComparer.Ordinal);

            // Map full member signature → set of ORIGINAL DECLARING TYPES.
            // A genuine conflict requires two or more *independent* types that each
            // declare the exact same signature. Diamond inheritance (one shared
            // declaration reached via multiple base paths) has a single declaring
            // type and is harmless.
            var sigToDeclarers = new Dictionary<string, HashSet<INamedTypeSymbol>>(StringComparer.Ordinal);
            foreach (var baseIface in directBases)
            {
                foreach (var m in MembersIncludingInherited(baseIface))
                {
                    if (!m.CanBeReferencedByName || string.IsNullOrEmpty(m.Name)) continue;
                    var sig = MemberSignature(m);
                    if (!sigToDeclarers.TryGetValue(sig, out var declarers))
                        sigToDeclarers[sig] = declarers = new HashSet<INamedTypeSymbol>(SymbolEqualityComparer.Default);
                    // Track the type that originally declared this member, not which
                    // base interface happens to expose it.
                    declarers.Add((INamedTypeSymbol)m.ContainingType);
                }
            }

            foreach (var (sig, declarers) in sigToDeclarers)
            {
                if (declarers.Count < 2) continue;         // single origin — no conflict
                if (ownSignatures.Contains(sig)) continue; // redeclared here — disambiguated

                var memberName = sig.Contains('(') ? sig[..sig.IndexOf('(')] : sig;
                var pos = ifaceDecl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Interface '{iface.Name}' inherits member '{memberName}' from {declarers.Count} independent base interfaces with the same signature, making access ambiguous.");
            }
        }
    }

    private static IEnumerable<ISymbol> MembersIncludingInherited(INamedTypeSymbol iface)
    {
        foreach (var m in iface.GetMembers()) yield return m;
        foreach (var b in iface.AllInterfaces)
            foreach (var m in b.GetMembers()) yield return m;
    }

    // Produces a stable key that distinguishes overloads but treats diamond-inherited
    // copies of the same declaration as identical.
    private static string MemberSignature(ISymbol m)
    {
        if (m is IMethodSymbol method)
        {
            var paramTypes = string.Join(",", method.Parameters.Select(p =>
                p.Type.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat)));
            return $"{method.Name}({paramTypes})";
        }
        // Properties, events, fields — keyed by name + kind to avoid cross-kind collisions.
        return $"{m.Name}:{m.Kind}";
    }
}
