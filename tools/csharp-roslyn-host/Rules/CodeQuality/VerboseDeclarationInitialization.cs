using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A local declaration that restates the type on both sides — `Foo x = new Foo()` —
/// where the declared type and the created type are identical, so either `var x = new
/// Foo()` or target-typed `Foo x = new()` conveys the same thing without the
/// repetition. We require an exact type match between the declared type and the
/// object-creation type (resolved through the semantic model), and skip `var`,
/// already-target-typed `new()`, and any case where the two types differ — so a
/// declaration whose static type is a base/interface of the created type is never
/// flagged. S3257.
/// </summary>
internal sealed class VerboseDeclarationInitialization : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/verbose-declaration-initialization";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var local in tree.GetRoot().DescendantNodes().OfType<LocalDeclarationStatementSyntax>())
        {
            var declaration = local.Declaration;
            // `var` is already concise; nothing to tighten.
            if (declaration.Type.IsVar) continue;
            // Only single-variable declarations have an unambiguous initializer to inline.
            if (declaration.Variables.Count != 1) continue;

            var variable = declaration.Variables[0];
            if (variable.Initializer?.Value is not ObjectCreationExpressionSyntax creation) continue;

            var declaredType = model.GetTypeInfo(declaration.Type).Type;
            var createdType = model.GetTypeInfo(creation).Type;
            if (declaredType is null || createdType is null) continue;
            // Exact identity only. If the declared type is a base/interface of the
            // created type, the explicit type is load-bearing and must stay.
            if (!SymbolEqualityComparer.Default.Equals(declaredType, createdType)) continue;

            var pos = declaration.Type.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Declaration repeats the type '{declaredType.Name}' on both sides; use 'var' or target-typed 'new()' to avoid restating it.");
        }
    }
}
