using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A property that declares a setter but no getter. A write-only property is
/// surprising — callers can store a value but never observe it — and usually a
/// method (e.g. SetX) would communicate intent better. Needs the resolved
/// property symbol to confirm the accessor shape. S2376 / CA1044.
/// </summary>
internal sealed class WriteOnlyProperty : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/write-only-property";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var prop in tree.GetRoot().DescendantNodes().OfType<PropertyDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(prop) is not IPropertySymbol sym) continue;
            // Write-only = has a setter and no getter.
            if (sym.SetMethod is null || sym.GetMethod is not null) continue;
            // An explicit interface implementation must match the interface; the author
            // doesn't control that shape, so don't flag it here.
            if (sym.ExplicitInterfaceImplementations.Length > 0) continue;
            // An override / interface implementation is dictated by the base; flag the
            // base declaration instead, not the forced override. abstract/virtual members
            // declare a contract a derived type must honor, so the write-only shape there
            // is deliberate — leave them alone too.
            if (sym.IsOverride || sym.IsAbstract || sym.IsVirtual || ImplementsInterfaceMember(sym)) continue;

            var pos = prop.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Property '{sym.Name}' exposes only a setter; a write-only property is surprising — consider a SetX method or add a getter.");
        }
    }

    private static bool ImplementsInterfaceMember(IPropertySymbol prop)
    {
        var type = prop.ContainingType;
        if (type is null) return false;
        foreach (var iface in type.AllInterfaces)
        {
            foreach (var member in iface.GetMembers().OfType<IPropertySymbol>())
            {
                if (SymbolEqualityComparer.Default.Equals(type.FindImplementationForInterfaceMember(member), prop))
                    return true;
            }
        }
        return false;
    }
}
