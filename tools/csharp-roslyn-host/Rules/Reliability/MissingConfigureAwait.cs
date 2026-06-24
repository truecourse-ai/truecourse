using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An <c>await</c> in library code that does not call <c>ConfigureAwait(false)</c>
/// (S3216 / CA2007). A library has no business capturing its caller's synchronization
/// context: when an app with a single-threaded context (classic WinForms/WPF/ASP.NET)
/// blocks on a returned task, resuming on the captured context deadlocks. Whether the
/// assembly is a library is decided by the project's <see cref="OutputKind"/>, so this
/// is project-aware. Kept false-positive free by the semantic model: only awaits whose
/// awaited type actually exposes a <c>ConfigureAwait</c> method are flagged (so
/// <c>await Task.Yield()</c> and custom awaitables without one are left alone), and an
/// await already ending in <c>ConfigureAwait(...)</c> is skipped.
/// </summary>
internal sealed class MissingConfigureAwait : IProjectAwareRule
{
    public string RuleKey => "reliability/deterministic/missing-configureawait";

    public IEnumerable<Violation> Analyze(ProjectContext ctx, SemanticModel model, SyntaxTree tree)
    {
        if (ctx.OutputKind != OutputKind.DynamicallyLinkedLibrary && ctx.OutputKind != OutputKind.NetModule)
            yield break;

        foreach (var awaitExpr in tree.GetRoot().DescendantNodes().OfType<AwaitExpressionSyntax>())
        {
            var expr = awaitExpr.Expression;

            // Already configured: `x.ConfigureAwait(false)` (or any ConfigureAwait call).
            if (expr is InvocationExpressionSyntax inv &&
                inv.Expression is MemberAccessExpressionSyntax ma &&
                ma.Name.Identifier.ValueText == "ConfigureAwait")
                continue;

            var type = model.GetTypeInfo(expr).Type;
            if (type is null || type.TypeKind == TypeKind.Error) continue;
            if (!type.GetMembers("ConfigureAwait").OfType<IMethodSymbol>().Any()) continue;

            var pos = expr.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "await in library code without ConfigureAwait(false) captures the caller's synchronization context and can deadlock callers that block on the task; add .ConfigureAwait(false).");
        }
    }
}
