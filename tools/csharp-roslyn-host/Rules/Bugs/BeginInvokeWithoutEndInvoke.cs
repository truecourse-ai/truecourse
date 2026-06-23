using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A delegate's <c>BeginInvoke</c> with no matching <c>EndInvoke</c> anywhere in
/// the file. The asynchronous delegate pattern requires every <c>BeginInvoke</c>
/// to be completed by an <c>EndInvoke</c> — otherwise the worker's return value is
/// lost, any exception it threw is swallowed, and the <c>IAsyncResult</c>'s wait
/// handle is never released, leaking a kernel object per call. The receiver is
/// resolved through the semantic model so only true delegate invocations are
/// flagged, never the unrelated <c>Control.BeginInvoke</c>/<c>Dispatcher.BeginInvoke</c>
/// marshalling APIs (which legitimately have no EndInvoke).
/// </summary>
internal sealed class BeginInvokeWithoutEndInvoke : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/begininvoke-without-endinvoke";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        var root = tree.GetRoot();

        // Conservative pairing: if any EndInvoke is present in the file, assume the
        // BeginInvoke calls are completed and stay silent — avoids false positives
        // when the EndInvoke happens in a callback or a sibling method.
        var hasEndInvoke = root.DescendantNodes().OfType<InvocationExpressionSyntax>().Any(inv =>
            inv.Expression is MemberAccessExpressionSyntax m && m.Name.Identifier.Text == "EndInvoke");
        if (hasEndInvoke) yield break;

        foreach (var inv in root.DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.Text != "BeginInvoke") continue;

            // Only a delegate's BeginInvoke needs EndInvoke; Control/Dispatcher do not.
            if (model.GetTypeInfo(ma.Expression).Type is not { TypeKind: TypeKind.Delegate }) continue;

            var pos = ma.Name.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Delegate BeginInvoke has no matching EndInvoke — the result and any exception are lost and the wait handle leaks.");
        }
    }
}
