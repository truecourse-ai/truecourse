using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An async method (or local function / lambda) whose entire body is a single
/// `return await someTask;` (or expression body `=> await someTask`) with no
/// surrounding try/catch/using/lock/finally. The async state machine adds an
/// allocation for no benefit — the method can drop `async`/`await` and return the
/// task directly. Needs semantic resolution to ensure the awaited expression's
/// type is assignable to the method's declared return type (otherwise removing
/// await would not compile). RCS1174.
/// </summary>
internal sealed class RedundantAsyncAwait : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/redundant-async-await";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (!method.Modifiers.Any(SyntaxKind.AsyncKeyword)) continue;
            if (model.GetDeclaredSymbol(method) is not IMethodSymbol sym) continue;

            // Find the single awaited expression that is also the only statement, if any.
            var awaited = SingleReturnAwait(method.Body, method.ExpressionBody);
            if (awaited is null) continue;

            // Removing await is only safe if the awaited task type is assignable to the
            // method's return type. `async Task` returning `await ValueTask` etc. would
            // change the signature — be conservative and require an exact match.
            var awaitedType = model.GetTypeInfo(awaited.Expression).Type;
            if (awaitedType is null) continue;
            if (!SymbolEqualityComparer.Default.Equals(awaitedType, sym.ReturnType)) continue;

            var pos = method.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Async method '{sym.Name}' only returns an awaited task; drop async/await and return the task directly to avoid an extra state machine.");
        }
    }

    /// Returns the lone `await` expression iff the body is exactly one `return await …`
    /// (block or expression-bodied) with no try/using/lock/finally wrapping it.
    private static AwaitExpressionSyntax? SingleReturnAwait(BlockSyntax? body, ArrowExpressionClauseSyntax? arrow)
    {
        if (arrow is not null)
            return arrow.Expression as AwaitExpressionSyntax;

        if (body is null) return null;
        if (body.Statements.Count != 1) return null;
        if (body.Statements[0] is not ReturnStatementSyntax { Expression: AwaitExpressionSyntax aw }) return null;
        return aw;
    }
}
