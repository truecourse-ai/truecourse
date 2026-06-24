using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A public, parameterless, non-static method named `Dispose` on a type that does
/// NOT implement IDisposable. `using` and disposal-aware callers key off the
/// interface, so this cleanup method is never invoked by them. Needs the
/// interface-implementation set to confirm IDisposable is absent.
/// </summary>
internal sealed class DisposeNotImplementingIDisposable : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/dispose-not-implementing-idisposable";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (method.Identifier.Text != "Dispose") continue;
            if (method.ParameterList.Parameters.Count != 0) continue;

            if (model.GetDeclaredSymbol(method) is not IMethodSymbol sym) continue;
            if (sym.DeclaredAccessibility != Accessibility.Public || sym.IsStatic) continue;
            if (!sym.ReturnsVoid) continue;

            var type = sym.ContainingType;
            if (type is null || type.TypeKind is not (TypeKind.Class or TypeKind.Struct)) continue;

            // If the type (or any base/interface) implements IDisposable, the method is
            // correctly wired — no finding. AllInterfaces covers the transitive set.
            if (type.AllInterfaces.Any(i => i.SpecialType == SpecialType.System_IDisposable))
                continue;

            var pos = method.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{type.Name}.Dispose()' does not implement IDisposable.Dispose — 'using' and disposal-aware callers will not invoke it.");
        }
    }
}
