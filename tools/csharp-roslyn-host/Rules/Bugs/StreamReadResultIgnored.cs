using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A <c>Stream.Read(buffer, offset, count)</c> call whose return value is discarded.
/// The return is the number of bytes actually read, which can be fewer than
/// requested (especially on network and pipe streams); ignoring it means the code
/// processes a partially-filled buffer as if it were complete, corrupting data. The
/// receiver type is resolved to <c>System.IO.Stream</c> (or a subclass) so only the
/// real, count-returning <c>Read</c> overload is flagged.
/// </summary>
internal sealed class StreamReadResultIgnored : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/stream-read-result-ignored";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var stmt in tree.GetRoot().DescendantNodes().OfType<ExpressionStatementSyntax>())
        {
            // The result is discarded exactly when the invocation is the whole statement.
            if (stmt.Expression is not InvocationExpressionSyntax inv) continue;
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.Text != "Read") continue;
            // The byte-count overload takes (buffer, offset, count) — the one that lies
            // about completeness; the Span overload likewise returns the count.
            var argc = inv.ArgumentList.Arguments.Count;
            if (argc != 3 && argc != 1) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol { ReturnType.SpecialType: SpecialType.System_Int32 } method) continue;
            if (method.Name != "Read") continue;
            if (!IsStream(method.ContainingType)) continue;

            var pos = ma.Name.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "The byte count returned by Stream.Read is ignored — a partial read leaves the buffer incomplete; loop until the requested count is read (or use ReadExactly).");
        }
    }

    private static bool IsStream(INamedTypeSymbol? type)
    {
        for (var t = type; t is not null; t = t.BaseType)
            if (t.Name == "Stream" && t.ContainingNamespace?.ToDisplayString() == "System.IO") return true;
        return false;
    }
}
