using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An overriding method has an optional parameter and calls the same base member
/// (`base.M(...)`) without forwarding that optional argument, so the base sees its OWN
/// default rather than the caller's value — almost always a missed forward. We only flag
/// when the base member has a same-named optional parameter that the base call omits and
/// no argument otherwise occupies its position. Matching the override to its overridden
/// member and reading the call's arguments needs the semantic model.
/// </summary>
internal sealed class OptionalArgNotForwardedToBase : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/optional-arg-not-forwarded-to-base";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (method.Body is null && method.ExpressionBody is null) continue;
            if (model.GetDeclaredSymbol(method) is not IMethodSymbol sym) continue;
            if (!sym.IsOverride || sym.OverriddenMethod is null) continue;

            // Optional parameters of the override that exist (by name) and are optional on the base too.
            var optional = sym.Parameters.Where(p => p.IsOptional).Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
            if (optional.Count == 0) continue;

            foreach (var inv in method.DescendantNodes().OfType<InvocationExpressionSyntax>())
            {
                if (inv.Expression is not MemberAccessExpressionSyntax { Expression: BaseExpressionSyntax } ma) continue;
                if (ma.Name.Identifier.ValueText != sym.Name) continue;
                if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol target) continue;
                if (!SymbolEqualityComparer.Default.Equals(target, sym.OverriddenMethod)) continue;

                var passed = PassedParameterNames(inv, target);
                foreach (var p in target.Parameters)
                {
                    if (!p.IsOptional) continue;
                    if (!optional.Contains(p.Name)) continue;   // the override exposes the same optional knob
                    if (passed.Contains(p.Name)) continue;       // already forwarded

                    var pos = ma.Name.GetLocation().GetLineSpan().StartLinePosition;
                    yield return new Violation(
                        RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                        $"base.{sym.Name} is called without forwarding optional parameter '{p.Name}', so the base uses its own default instead of the value passed to this override.");
                    break;
                }
            }
        }
    }

    // Resolve which of the target's parameters actually receive an argument at this call,
    // accounting for positional and named arguments.
    private static HashSet<string> PassedParameterNames(InvocationExpressionSyntax inv, IMethodSymbol target)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        var args = inv.ArgumentList.Arguments;
        for (var i = 0; i < args.Count; i++)
        {
            var arg = args[i];
            if (arg.NameColon is { } nc)
                names.Add(nc.Name.Identifier.ValueText);
            else if (i < target.Parameters.Length)
                names.Add(target.Parameters[i].Name);
        }
        return names;
    }
}
