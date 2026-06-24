using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A method with a <c>CancellationToken</c> in scope calls another method that has
/// an overload accepting a trailing CancellationToken, yet passes none — silently
/// dropping cancellation. Mirrors CA2016. Requires the semantic model to (a) find
/// the in-scope token, (b) confirm the called method's type offers an overload with
/// the same parameters plus one trailing CancellationToken, and (c) verify the call
/// does not already supply a token. Only fires when such an overload provably
/// exists, so it never flags a method that simply cannot take a token.
/// </summary>
internal sealed class CancellationTokenNotForwarded : ISemanticRule
{
    private const string CtMetadataName = "System.Threading.CancellationToken";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        var ctType = model.Compilation.GetTypeByMetadataName(CtMetadataName);
        if (ctType is null) yield break;

        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol called) continue;

            // We only flag the unambiguous case: the bound overload takes NO token,
            // yet a sibling overload that appends exactly one trailing token exists.
            // (The "optional token default left unspecified" variant is omitted to
            // avoid any false positive from named/optional argument bookkeeping.)
            if (called.Parameters.Any(p => SymbolEqualityComparer.Default.Equals(p.Type, ctType))) continue;
            if (!HasTokenAppendingOverload(called, ctType)) continue;
            if (TokenInScope(inv, ctType, model) is null) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{called.Name}' has an overload that accepts a CancellationToken but none is forwarded — cancellation is silently dropped.");
        }
    }

    public string RuleKey => "reliability/deterministic/cancellationtoken-not-forwarded";

    /// <summary>
    /// True if the called method's containing type exposes an overload with the
    /// same name whose parameter list is exactly this method's parameters plus one
    /// trailing CancellationToken.
    /// </summary>
    private static bool HasTokenAppendingOverload(IMethodSymbol called, INamedTypeSymbol ctType)
    {
        var baseParams = called.Parameters;
        foreach (var member in called.ContainingType.GetMembers(called.Name).OfType<IMethodSymbol>())
        {
            if (SymbolEqualityComparer.Default.Equals(member, called)) continue;
            if (member.Parameters.Length != baseParams.Length + 1) continue;
            if (!SymbolEqualityComparer.Default.Equals(member.Parameters[^1].Type, ctType)) continue;

            var same = true;
            for (var i = 0; i < baseParams.Length; i++)
            {
                if (!SymbolEqualityComparer.Default.Equals(member.Parameters[i].Type, baseParams[i].Type))
                {
                    same = false;
                    break;
                }
            }
            if (same) return true;
        }
        return false;
    }

    /// <summary>
    /// A CancellationToken parameter on the nearest enclosing method/local function/
    /// lambda, if any. We deliberately only consider parameters — not arbitrary
    /// fields/locals — so the rule stays conservative and self-evidently correct.
    /// </summary>
    private static IParameterSymbol? TokenInScope(SyntaxNode node, INamedTypeSymbol ctType, SemanticModel model)
    {
        for (SyntaxNode? n = node; n is not null; n = n.Parent)
        {
            var sym = n switch
            {
                MethodDeclarationSyntax m => model.GetDeclaredSymbol(m) as IMethodSymbol,
                LocalFunctionStatementSyntax lf => model.GetDeclaredSymbol(lf) as IMethodSymbol,
                ParenthesizedLambdaExpressionSyntax pl => model.GetSymbolInfo(pl).Symbol as IMethodSymbol,
                _ => null,
            };

            if (sym is not null)
                foreach (var p in sym.Parameters)
                    if (SymbolEqualityComparer.Default.Equals(p.Type, ctType))
                        return p;

            if (n is MethodDeclarationSyntax or LocalFunctionStatementSyntax) break;
        }
        return null;
    }
}
