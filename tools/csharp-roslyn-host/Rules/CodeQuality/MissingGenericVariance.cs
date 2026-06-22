using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An interface type parameter that is invariant but is used only in output positions
/// (method return types / read-only property types) and never in an input position.
/// Declaring it `out` would let callers assign `IReader&lt;Derived&gt;` to
/// `IReader&lt;Base&gt;`. We analyze every member of the interface, classify each
/// occurrence of the type parameter as input or output, and flag only when it appears
/// exclusively as output (the safe, unambiguous covariance case).
/// </summary>
internal sealed class MissingGenericVariance : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/missing-generic-variance";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var ifaceDecl in tree.GetRoot().DescendantNodes().OfType<InterfaceDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(ifaceDecl) is not INamedTypeSymbol iface) continue;
            if (iface.TypeParameters.Length == 0) continue;

            foreach (var tp in iface.TypeParameters)
            {
                if (tp.Variance != VarianceKind.None) continue; // already in/out

                var usage = ClassifyUsage(iface, tp);
                // Only flag the covariant (output-only) case: it has no constraints
                // that would block `out` and produces the clearest, least surprising fix.
                if (usage is { UsedAsOutput: true, UsedAsInput: false }
                    && !HasVarianceBlockingConstraint(tp))
                {
                    var decl = TypeParameterIdentifier(ifaceDecl, tp.Name);
                    var pos = decl.GetLineSpan().StartLinePosition;
                    yield return new Violation(
                        RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                        $"Type parameter '{tp.Name}' of interface '{iface.Name}' is used only in output positions; mark it 'out' for covariance.");
                }
            }
        }
    }

    private readonly record struct Usage(bool UsedAsInput, bool UsedAsOutput);

    private static Usage ClassifyUsage(INamedTypeSymbol iface, ITypeParameterSymbol tp)
    {
        bool input = false, output = false;
        foreach (var member in iface.GetMembers())
        {
            switch (member)
            {
                case IMethodSymbol m when m.MethodKind is MethodKind.Ordinary:
                    foreach (var p in m.Parameters)
                    {
                        // ref/out parameters are bidirectional — any occurrence there is
                        // both, which conservatively disqualifies covariance.
                        if (Mentions(p.Type, tp))
                        {
                            if (p.RefKind != RefKind.None) { input = true; output = true; }
                            else input = true;
                        }
                    }
                    if (Mentions(m.ReturnType, tp)) output = true;
                    foreach (var mtp in m.TypeParameters)
                        foreach (var c in mtp.ConstraintTypes)
                            if (Mentions(c, tp)) input = true;
                    break;
                case IPropertySymbol prop:
                    if (Mentions(prop.Type, tp))
                    {
                        if (prop.GetMethod is not null) output = true;
                        if (prop.SetMethod is not null) input = true;
                    }
                    foreach (var ip in prop.Parameters) // indexer params
                        if (Mentions(ip.Type, tp)) input = true;
                    break;
                case IEventSymbol ev when Mentions(ev.Type, tp):
                    // Events accept handlers (input) on add/remove.
                    input = true;
                    break;
            }
        }
        return new Usage(input, output);
    }

    /// True if the type parameter appears anywhere in this type (directly or as a
    /// type argument). A nested generic that uses it is conservatively treated as a
    /// mention; we don't attempt position analysis inside arbitrary generics.
    private static bool Mentions(ITypeSymbol type, ITypeParameterSymbol tp)
    {
        switch (type)
        {
            case ITypeParameterSymbol p:
                return SymbolEqualityComparer.Default.Equals(p, tp);
            case IArrayTypeSymbol arr:
                return Mentions(arr.ElementType, tp);
            case INamedTypeSymbol named:
                foreach (var ta in named.TypeArguments)
                    if (Mentions(ta, tp)) return true;
                return false;
            default:
                return false;
        }
    }

    private static bool HasVarianceBlockingConstraint(ITypeParameterSymbol tp) =>
        // `struct` (value-type) constraint precludes variance.
        tp.HasValueTypeConstraint;

    private static Location TypeParameterIdentifier(InterfaceDeclarationSyntax iface, string name)
    {
        foreach (var p in iface.TypeParameterList?.Parameters ?? default)
            if (p.Identifier.ValueText == name) return p.Identifier.GetLocation();
        return iface.Identifier.GetLocation();
    }
}
