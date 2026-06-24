using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A `ConcurrentDictionary.GetOrAdd` / `AddOrUpdate` whose factory lambda captures
/// a variable from the enclosing scope instead of taking it through the state
/// parameter overload. Each call then allocates a closure to carry the captured
/// value. Both the receiver type (ConcurrentDictionary) and proving a real capture
/// (an identifier resolving to a symbol declared outside the lambda) need the
/// semantic model.
/// </summary>
internal sealed class ConcurrentDictionaryCapturesArgument : ISemanticRule
{
    public string RuleKey => "performance/deterministic/concurrentdictionary-captures-argument";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.Text is not ("GetOrAdd" or "AddOrUpdate")) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.ContainingType is not INamedTypeSymbol { Name: "ConcurrentDictionary" }) continue;
            // Only the overloads WITHOUT a state parameter (the ones the analyzer wants
            // you to migrate off). A state overload has the value as a trailing arg.
            if (HasStateParameter(m)) continue;

            foreach (var arg in inv.ArgumentList.Arguments)
            {
                if (arg.Expression is not LambdaExpressionSyntax lambda) continue;
                if (CapturesOutside(model, lambda))
                {
                    var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
                    yield return new Violation(
                        RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                        $"The {ma.Name.Identifier.Text} factory captures a variable from the enclosing scope, allocating a closure per call — pass it through the state-parameter overload instead.");
                    break;
                }
            }
        }
    }

    private static bool HasStateParameter(IMethodSymbol m)
    {
        // Heuristic on the resolved overload: a state overload carries a TArg/factory
        // arg generic parameter (more than the no-state arity). For GetOrAdd the
        // state overload has 3 parameters (key, factory, factoryArgument); for
        // AddOrUpdate it has 5. Treat anything wider than the plain factory overload
        // as already using state.
        return m.Name switch
        {
            "GetOrAdd" => m.Parameters.Length >= 3,
            "AddOrUpdate" => m.Parameters.Length >= 5,
            _ => false,
        };
    }

    private static bool CapturesOutside(SemanticModel model, LambdaExpressionSyntax lambda)
    {
        var flow = model.AnalyzeDataFlow(lambda.Body);
        if (flow is null || !flow.Succeeded) return false;

        // The lambda's own parameters flow into its body but are NOT captures — only
        // variables declared in an enclosing scope are. Exclude the lambda parameters.
        var ownParams = new HashSet<ISymbol>(
            (model.GetSymbolInfo(lambda).Symbol as IMethodSymbol)?.Parameters
                ?? Enumerable.Empty<IParameterSymbol>(),
            SymbolEqualityComparer.Default);

        return flow.DataFlowsIn.Any(s =>
            s is ILocalSymbol or IParameterSymbol && !ownParams.Contains(s));
    }
}
