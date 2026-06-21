using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An override adds the `params` modifier to its last parameter where the overridden base
/// method did NOT have it (or vice-versa). `params` is honored from the static type at the
/// call site, so callers through the base reference cannot use the variadic form even though
/// callers through the derived type can — behavior depends on the static type. Comparing the
/// override's `params` flag to the base member's needs the resolved overridden symbol. S3600.
/// </summary>
internal sealed class ParamsIntroducedOnOverride : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/params-introduced-on-override";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(method) is not IMethodSymbol sym) continue;
            if (!sym.IsOverride || sym.OverriddenMethod is null) continue;
            if (sym.Parameters.Length == 0) continue;

            var baseMethod = sym.OverriddenMethod;
            if (sym.Parameters.Length != baseMethod.Parameters.Length) continue; // signatures should match

            var lastIdx = sym.Parameters.Length - 1;
            if (lastIdx >= method.ParameterList.Parameters.Count) continue;
            var lastParamSyntax = method.ParameterList.Parameters[lastIdx];

            // The override's symbol reports the *effective* (base-inherited) params-ness, so
            // we read the syntactic `params` modifier the author actually wrote and compare it
            // to the base method's symbol.
            var derivedParams = lastParamSyntax.Modifiers.Any(SyntaxKind.ParamsKeyword);
            var baseParams = baseMethod.Parameters[lastIdx].IsParams;
            if (derivedParams == baseParams) continue;

            var paramSyntax = (Microsoft.CodeAnalysis.SyntaxNode)lastParamSyntax;
            var pos = paramSyntax.GetLocation().GetLineSpan().StartLinePosition;
            var verb = derivedParams ? "adds the 'params' modifier the base method lacks" : "drops the 'params' modifier the base method has";
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Override of '{baseMethod.ContainingType.Name}.{sym.Name}' {verb} — the variadic form then depends on the static type of the reference; keep the base's signature.");
        }
    }
}
