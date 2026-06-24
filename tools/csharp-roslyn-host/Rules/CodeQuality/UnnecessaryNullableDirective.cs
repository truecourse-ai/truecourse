using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A leading <c>#nullable enable</c>/<c>#nullable disable</c> that merely restates the
/// project-level nullable context (IDE0241), so the directive is pure noise — the project
/// already puts the file in exactly that state. Needs the project's
/// <see cref="NullableContextOptions"/>, so it runs in workspace mode. Scoped to the very
/// first directive in the file with no annotations/warnings target (the unambiguous
/// whole-context case); the file-local "restates an earlier directive" case is reported by
/// redundant-nullable-directive, and a directive that changes the context never fires.
/// </summary>
internal sealed class UnnecessaryNullableDirective : IProjectAwareRule
{
    public string RuleKey => "code-quality/deterministic/unnecessary-nullable-directive";

    public IEnumerable<Violation> Analyze(ProjectContext ctx, SemanticModel model, SyntaxTree tree)
    {
        var first = tree.GetRoot()
            .DescendantNodes(descendIntoTrivia: true)
            .OfType<NullableDirectiveTriviaSyntax>()
            .FirstOrDefault();
        if (first is null) yield break;
        if (!first.TargetToken.IsKind(SyntaxKind.None)) yield break; // scoped directive — leave it

        var project = (model.Compilation.Options as CSharpCompilationOptions)?.NullableContextOptions
            ?? NullableContextOptions.Disable;
        var setting = first.SettingToken.Kind();
        var unnecessary =
            (setting == SyntaxKind.EnableKeyword && project == NullableContextOptions.Enable) ||
            (setting == SyntaxKind.DisableKeyword && project == NullableContextOptions.Disable);
        if (!unnecessary) yield break;

        var pos = first.GetLocation().GetLineSpan().StartLinePosition;
        yield return new Violation(
            RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
            $"This #nullable {first.SettingToken.ValueText} only restates the project-level nullable context, so it has no effect.");
    }
}
