using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A global <c>[SuppressMessage(..., Target = "~…")]</c> whose documentation-ID target does
/// not resolve to any symbol in the compilation (IDE0076), so the suppression silently
/// matches nothing and the diagnostic it was meant to silence keeps (or stops) firing
/// unnoticed. Resolved against the whole project via
/// <see cref="DocumentationCommentId.GetFirstSymbolForDeclarationId"/>, so it needs the
/// loaded project (workspace mode). Scoped to documentation-ID targets (leading <c>~</c>);
/// the legacy FxCop format is reported separately by legacy-suppressmessage-target, and a
/// target that does resolve never fires.
/// </summary>
internal sealed class InvalidSuppressMessageTarget : IProjectAwareRule
{
    public string RuleKey => "code-quality/deterministic/invalid-suppressmessage-target";

    public IEnumerable<Violation> Analyze(ProjectContext ctx, SemanticModel model, SyntaxTree tree)
    {
        foreach (var attr in tree.GetRoot().DescendantNodes().OfType<AttributeSyntax>())
        {
            if (AttrSimpleName(attr) != "SuppressMessage" || attr.ArgumentList is null) continue;

            foreach (var arg in attr.ArgumentList.Arguments)
            {
                if (arg.NameEquals?.Name.Identifier.ValueText != "Target") continue;
                if (arg.Expression is not LiteralExpressionSyntax lit || !lit.IsKind(SyntaxKind.StringLiteralExpression)) continue;

                var target = lit.Token.ValueText;
                if (string.IsNullOrEmpty(target) || target[0] != '~') continue; // doc-ID format only

                var declarationId = target.Substring(1);
                if (DocumentationCommentId.GetFirstSymbolForDeclarationId(declarationId, model.Compilation) is not null) continue;

                var pos = lit.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"SuppressMessage Target \"{target}\" does not resolve to any symbol in the compilation, so the suppression matches nothing and is silently ineffective.");
            }
        }
    }

    private static string AttrSimpleName(AttributeSyntax attr)
    {
        var name = attr.Name.ToString();
        var simple = name.Contains('.') ? name[(name.LastIndexOf('.') + 1)..] : name;
        return simple.EndsWith("Attribute") ? simple[..^"Attribute".Length] : simple;
    }
}
