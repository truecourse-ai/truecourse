using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A call that binds to a fixed-arity overload while a <c>params</c> overload with the
/// same leading parameters would also accept the arguments (S3220) — the classic
/// <c>M(a, b)</c> vs <c>M(a, params b[])</c> pair, where the reader cannot tell which
/// runs without counting parameters and one extra argument silently switches overloads.
/// Resolved with the semantic model and kept false-positive free: only the author's own
/// overloads are considered (BCL ladders such as Console.WriteLine / string.Format are
/// not ours to change), the params sibling's fixed parameters must be a type-prefix of
/// the bound overload's, and the call must supply more arguments than that prefix so they
/// genuinely spill into the params array.
/// </summary>
internal sealed class ParamsOverloadAmbiguity : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/params-overload-ambiguity";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol target) continue;
            if (!target.Locations.Any(l => l.IsInSource)) continue;
            if (target.Parameters.LastOrDefault()?.IsParams == true) continue;
            if (target.ContainingType is null) continue;

            var argCount = inv.ArgumentList.Arguments.Count;
            if (target.Parameters.Length != argCount) continue;

            var hasSpillingSibling = target.ContainingType
                .GetMembers(target.Name)
                .OfType<IMethodSymbol>()
                .Any(m => !SymbolEqualityComparer.Default.Equals(m, target) && IsSpillingParamsSibling(m, target, argCount));
            if (!hasSpillingSibling) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"This call binds to the fixed-arity overload of '{target.Name}', but a params overload with the same leading parameters also accepts these arguments — the chosen overload is easy to misread, and one more argument would switch it.");
        }
    }

    // The candidate is a params overload whose fixed parameters are a type-prefix of the
    // bound overload's, with fewer of them than the call supplies (so arguments spill
    // into the params array) — the genuine M(a, b) vs M(a, params b[]) ladder.
    private static bool IsSpillingParamsSibling(IMethodSymbol candidate, IMethodSymbol target, int argCount)
    {
        if (candidate.Parameters.LastOrDefault()?.IsParams != true) return false;
        var fixedCount = candidate.Parameters.Length - 1;
        if (fixedCount >= argCount || fixedCount > target.Parameters.Length) return false;
        for (var i = 0; i < fixedCount; i++)
            if (!SymbolEqualityComparer.Default.Equals(candidate.Parameters[i].Type, target.Parameters[i].Type))
                return false;
        return true;
    }
}
