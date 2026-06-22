using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A local variable declared with an initializer, then read exactly once, in the
/// immediately following statement, and never written again. The name adds nothing —
/// inlining the initializer keeps the value at its point of use. We require the read
/// to be on the very next statement so the inline is mechanical and behaviour-
/// preserving. Needs dataflow within the method to count reads/writes precisely.
/// RCS1124.
/// </summary>
internal sealed class InlineSingleUseLocal : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/inline-single-use-local";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var decl in tree.GetRoot().DescendantNodes().OfType<LocalDeclarationStatementSyntax>())
        {
            // Single declarator with an initializer, not `const`, not `ref`/`using`.
            if (decl.UsingKeyword.RawKind != (int)Microsoft.CodeAnalysis.CSharp.SyntaxKind.None) continue;
            if (decl.Declaration.Variables.Count != 1) continue;
            var v = decl.Declaration.Variables[0];
            if (v.Initializer is null) continue;
            if (model.GetDeclaredSymbol(v) is not ILocalSymbol local) continue;
            if (local.IsConst || local.IsRef) continue;

            // Restrict to the canonical "compute then immediately use" case: the
            // initializer is a method/property/indexer result. A bare object/collection
            // construction (`new T()`) reads fine as a named temporary and inlining it
            // buys nothing, so we leave those alone to stay false-positive-free.
            if (!IsComputedInitializer(v.Initializer.Value)) continue;

            // The statement immediately after the declaration must exist and be the only
            // place the local appears.
            if (decl.Parent is not BlockSyntax block) continue;
            var idx = block.Statements.IndexOf(decl);
            if (idx < 0 || idx + 1 >= block.Statements.Count) continue;
            var nextStmt = block.Statements[idx + 1];

            // Count references across the whole enclosing block: must be exactly one, and
            // it must live inside the next statement (a read, never a write).
            var refs = ReferencesIn(block, local, model).ToList();
            if (refs.Count != 1) continue;
            var theRef = refs[0];
            if (!nextStmt.Span.Contains(theRef.Span)) continue;
            if (IsWrite(theRef)) continue;

            // Only flag a pure passthrough — the local used as the WHOLE value of the
            // next statement (`return x;`, `x;`, or `y = x;`). When it appears as a
            // sub-expression (`x.Member`, `!x`, `f(x)`, `x ? a : b`), the name aids
            // readability and inlining would nest it into a larger expression, so leave
            // it alone — that's the idiomatic "name the intermediate" case, not a defect.
            if (!IsBarePassthrough(theRef)) continue;

            var pos = v.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Local '{local.Name}' is used exactly once on the next statement; inline its initializer at the point of use.");
        }
    }

    /// True when the single read is the WHOLE value of its statement — `return x;`,
    /// a bare `x;`, or `y = x;` — so inlining is a mechanical, readability-neutral
    /// substitution. A read nested inside a larger expression returns false.
    private static bool IsBarePassthrough(IdentifierNameSyntax read) => read.Parent switch
    {
        ReturnStatementSyntax => true,
        ExpressionStatementSyntax => true,
        AssignmentExpressionSyntax a when a.Right == read && a.Parent is ExpressionStatementSyntax => true,
        _ => false,
    };

    /// True when the initializer is a method invocation (the classic compute-then-use
    /// case). Object/collection/array creation is intentionally excluded.
    private static bool IsComputedInitializer(ExpressionSyntax expr) => expr switch
    {
        InvocationExpressionSyntax => true,
        AwaitExpressionSyntax aw => aw.Expression is InvocationExpressionSyntax,
        _ => false,
    };

    private static IEnumerable<IdentifierNameSyntax> ReferencesIn(BlockSyntax block, ILocalSymbol local, SemanticModel model)
    {
        foreach (var id in block.DescendantNodes().OfType<IdentifierNameSyntax>())
        {
            if (id.Identifier.ValueText != local.Name) continue;
            if (model.GetSymbolInfo(id).Symbol is ILocalSymbol l
                && SymbolEqualityComparer.Default.Equals(l, local))
                yield return id;
        }
    }

    private static bool IsWrite(IdentifierNameSyntax id)
    {
        switch (id.Parent)
        {
            case AssignmentExpressionSyntax assign when assign.Left == id:
                return true;
            case PrefixUnaryExpressionSyntax pre when pre.OperatorToken.Text is "++" or "--":
                return true;
            case PostfixUnaryExpressionSyntax post when post.OperatorToken.Text is "++" or "--":
                return true;
            case ArgumentSyntax { RefKindKeyword.RawKind: not (int)Microsoft.CodeAnalysis.CSharp.SyntaxKind.None }:
                return true;
            default:
                return false;
        }
    }
}
