using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A call that explicitly passes a constant argument equal to the parameter's own
/// declared default value, where omitting it would be clearer and identical. Needs
/// the resolved parameter (to read its default) and the argument's constant value.
/// </summary>
internal sealed class ExplicitDefaultArgument : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/explicit-default-argument";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            var args = inv.ArgumentList.Arguments;
            if (args.Count == 0) continue;
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;

            for (var i = 0; i < args.Count; i++)
            {
                var arg = args[i];
                // Only positional trailing arguments can be safely dropped. A named
                // argument that matches its default, when followed by other supplied
                // args, can't simply be removed, so restrict to positional.
                if (arg.NameColon is not null) continue;
                if (i >= m.Parameters.Length) break;

                var p = m.Parameters[i];
                if (!p.IsOptional || p.IsParams) continue;
                if (!p.HasExplicitDefaultValue) continue;

                // This must be the LAST supplied argument for that optional run — i.e.
                // every following argument is also a droppable positional default.
                // We only flag the trailing-most explicit default to avoid suggesting
                // an illegal removal that leaves a positional gap.
                if (i != args.Count - 1) continue;

                var constant = model.GetConstantValue(arg.Expression);
                if (!constant.HasValue) continue;

                if (Equals(constant.Value, p.ExplicitDefaultValue))
                {
                    var pos = arg.GetLocation().GetLineSpan().StartLinePosition;
                    yield return new Violation(
                        RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                        $"Argument for '{p.Name}' equals the parameter's default value; it can be omitted.");
                }
            }
        }
    }
}
