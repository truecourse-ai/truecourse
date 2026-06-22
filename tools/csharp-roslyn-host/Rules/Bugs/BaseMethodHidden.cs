using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A derived method whose signature matches an accessible base method but carries
/// neither `override` nor `new`. The compiler emits a warning and silently hides
/// the base member, so calls through a base reference dispatch to the base body —
/// a real dispatch surprise. Needs the base-type chain and overload comparison. CA1061.
/// </summary>
internal sealed class BaseMethodHidden : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/base-method-hidden";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            // Only the absence of both modifiers can hide. `new`/`override`/`partial`
            // are explicit author intent; abstract/static can't hide an instance method.
            var mods = method.Modifiers;
            if (mods.Any(Microsoft.CodeAnalysis.CSharp.SyntaxKind.OverrideKeyword) ||
                mods.Any(Microsoft.CodeAnalysis.CSharp.SyntaxKind.NewKeyword) ||
                mods.Any(Microsoft.CodeAnalysis.CSharp.SyntaxKind.PartialKeyword) ||
                mods.Any(Microsoft.CodeAnalysis.CSharp.SyntaxKind.StaticKeyword))
                continue;

            if (model.GetDeclaredSymbol(method) is not IMethodSymbol sym) continue;
            if (sym.ContainingType is not { TypeKind: TypeKind.Class } type) continue;

            for (var b = type.BaseType; b is not null; b = b.BaseType)
            {
                var hidden = b.GetMembers(sym.Name).OfType<IMethodSymbol>().FirstOrDefault(
                    m => m.MethodKind == MethodKind.Ordinary &&
                         !m.IsStatic &&
                         m.DeclaredAccessibility != Accessibility.Private &&
                         SignatureMatches(m, sym));
                if (hidden is null) continue;

                // A virtual/abstract base member that we match without `override` is a
                // different diagnostic (the compiler still warns, and `override` is the
                // fix). Reporting only the genuinely-hidden non-virtual case keeps us
                // free of overlap and false positives.
                if (hidden.IsVirtual || hidden.IsAbstract || hidden.IsOverride) break;

                var pos = method.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"'{sym.Name}' hides the inherited member '{b.Name}.{sym.Name}' — add 'new' if intentional, or rename; otherwise base-typed callers dispatch to the base method.");
                break;
            }
        }
    }

    private static bool SignatureMatches(IMethodSymbol a, IMethodSymbol b)
    {
        if (a.Parameters.Length != b.Parameters.Length) return false;
        if (a.Arity != b.Arity) return false;
        for (var i = 0; i < a.Parameters.Length; i++)
        {
            if (a.Parameters[i].RefKind != b.Parameters[i].RefKind) return false;
            if (!SymbolEqualityComparer.Default.Equals(a.Parameters[i].Type, b.Parameters[i].Type))
                return false;
        }
        return true;
    }
}
