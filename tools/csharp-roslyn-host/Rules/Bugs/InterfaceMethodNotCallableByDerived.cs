using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An EXPLICIT interface-method implementation on an unsealed class with no accessible
/// re-exposed member of the same name. Explicit implementations are private to the
/// class, so a derived type cannot call `base.Method()` and has no way to reuse the
/// behaviour — usually unintended for an extensible (unsealed) type. We require: the
/// class is unsealed and non-static, the member is an explicit interface
/// implementation, and the class exposes no public/protected member of the same name.
/// Needs ExplicitInterfaceImplementations and the member set.
/// </summary>
internal sealed class InterfaceMethodNotCallableByDerived : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/interface-method-not-callable-by-derived";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (method.ExplicitInterfaceSpecifier is null) continue;
            if (model.GetDeclaredSymbol(method) is not IMethodSymbol m) continue;
            if (m.ExplicitInterfaceImplementations.IsDefaultOrEmpty) continue;

            var type = m.ContainingType;
            if (type is null || type.TypeKind != TypeKind.Class) continue;
            if (type.IsSealed || type.IsStatic) continue;

            var name = m.ExplicitInterfaceImplementations[0].Name;

            // If the class re-exposes an accessible member of the same name, derived types
            // can reach the behaviour — not a finding.
            bool reExposed = type.GetMembers(name).Any(member =>
                !SymbolEqualityComparer.Default.Equals(member, m) &&
                member.DeclaredAccessibility is Accessibility.Public or Accessibility.Protected
                    or Accessibility.ProtectedOrInternal &&
                IsNotExplicitImpl(member));
            if (reExposed) continue;

            var pos = method.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Explicit interface method '{name}' on unsealed class '{type.Name}' is not callable by derived types and is not re-exposed. Add an accessible method that delegates to it, or seal the class.");
        }
    }

    private static bool IsNotExplicitImpl(ISymbol member) => member switch
    {
        IMethodSymbol mm => mm.ExplicitInterfaceImplementations.IsDefaultOrEmpty,
        IPropertySymbol pp => pp.ExplicitInterfaceImplementations.IsDefaultOrEmpty,
        IEventSymbol ee => ee.ExplicitInterfaceImplementations.IsDefaultOrEmpty,
        _ => true,
    };
}
