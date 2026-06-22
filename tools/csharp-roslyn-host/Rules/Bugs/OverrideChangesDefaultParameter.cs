using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An overriding method declares a DIFFERENT default value for an optional parameter than
/// the base member does. Default values are baked in at the call site from the STATIC type
/// of the reference, so `((Base)d).M()` and `d.M()` silently pass different defaults — a
/// behavioral split that depends only on the declared type. Comparing the override's
/// default constants against the overridden member's needs the semantic model.
/// </summary>
internal sealed class OverrideChangesDefaultParameter : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/override-changes-default-parameter";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(method) is not IMethodSymbol sym) continue;
            if (!sym.IsOverride || sym.OverriddenMethod is null) continue;

            var baseMethod = sym.OverriddenMethod;
            var n = Math.Min(sym.Parameters.Length, baseMethod.Parameters.Length);
            for (var i = 0; i < n; i++)
            {
                var dp = sym.Parameters[i];
                var bp = baseMethod.Parameters[i];

                // Only meaningful when both supply a default and they differ.
                if (!dp.HasExplicitDefaultValue || !bp.HasExplicitDefaultValue) continue;
                if (Equals(dp.ExplicitDefaultValue, bp.ExplicitDefaultValue)) continue;

                var paramSyntax = i < method.ParameterList.Parameters.Count
                    ? method.ParameterList.Parameters[i]
                    : null;
                var loc = (paramSyntax as Microsoft.CodeAnalysis.SyntaxNode ?? method).GetLocation();
                var pos = loc.GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Override of '{baseMethod.ContainingType.Name}.{sym.Name}' changes the default of '{dp.Name}' from {Format(bp.ExplicitDefaultValue)} to {Format(dp.ExplicitDefaultValue)} — the value used depends on the static type of the reference.");
            }
        }
    }

    private static string Format(object? v) => v is null ? "null" : v is string s ? $"\"{s}\"" : v.ToString() ?? "?";
}
