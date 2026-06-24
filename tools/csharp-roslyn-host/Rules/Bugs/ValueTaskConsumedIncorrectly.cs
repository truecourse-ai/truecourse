using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A <c>ValueTask</c>/<c>ValueTask&lt;T&gt;</c> consumed more than once. Unlike
/// <c>Task</c>, a <c>ValueTask</c> may be backed by a pooled
/// <c>IValueTaskSource</c> that is recycled the instant it is first awaited (or its
/// result read), so a second <c>await</c>, <c>.Result</c>, <c>.GetAwaiter()</c> or
/// <c>.AsTask()</c> observes a reused, unrelated operation — corruption that is
/// nearly impossible to reproduce. Counts the consumptions of each value-task local
/// or parameter and flags the offending second one, so the normal single-await path
/// is never touched.
/// </summary>
internal sealed class ValueTaskConsumedIncorrectly : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/valuetask-consumed-incorrectly";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        var consumptions = new Dictionary<ISymbol, List<SyntaxNode>>(SymbolEqualityComparer.Default);
        foreach (var id in tree.GetRoot().DescendantNodes().OfType<IdentifierNameSyntax>())
        {
            if (!IsConsumption(id)) continue;
            if (model.GetSymbolInfo(id).Symbol is not { } sym) continue;
            if (!IsValueTaskVariable(sym)) continue;
            if (!consumptions.TryGetValue(sym, out var list)) consumptions[sym] = list = new List<SyntaxNode>();
            list.Add(id);
        }

        foreach (var (sym, list) in consumptions)
        {
            if (list.Count < 2) continue;
            var offending = list[1]; // the second consumption is the bug
            var pos = offending.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"ValueTask '{sym.Name}' is consumed again here — a ValueTask must be awaited or read at most once; await it once or convert to a Task with AsTask().");
        }
    }

    private static bool IsValueTaskVariable(ISymbol sym)
    {
        var type = sym switch
        {
            ILocalSymbol l => l.Type,
            IParameterSymbol p => p.Type,
            _ => null,
        };
        return type is { Name: "ValueTask" } && type.ContainingNamespace?.ToDisplayString() == "System.Threading.Tasks";
    }

    /// <summary>True when this reference awaits the value task or reads its result.</summary>
    private static bool IsConsumption(IdentifierNameSyntax id)
    {
        if (id.Parent is AwaitExpressionSyntax) return true;
        if (id.Parent is MemberAccessExpressionSyntax ma && ma.Expression == id)
            return ma.Name.Identifier.Text is "Result" or "GetAwaiter" or "AsTask";
        return false;
    }
}
