using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A method/property/delegate whose return type is the bare identifier
/// <c>partial</c>. Newer C# rules treat <c>partial</c> as a type modifier in more
/// positions, so a return type named partial must be escaped as <c>@partial</c> to
/// keep parsing unambiguously. We flag only an unescaped <c>partial</c> used in
/// return-type position and confirm via the semantic model that it binds to a real
/// named type (not the modifier), so legitimate partial-member declarations are
/// never touched.
/// </summary>
internal sealed class PartialReturnTypeEscape : ISemanticRule
{
    public string RuleKey => "style/deterministic/partial-return-type-escape";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var node in tree.GetRoot().DescendantNodes())
        {
            var returnType = node switch
            {
                MethodDeclarationSyntax m => m.ReturnType,
                DelegateDeclarationSyntax d => d.ReturnType,
                PropertyDeclarationSyntax p => p.Type,
                IndexerDeclarationSyntax i => i.Type,
                OperatorDeclarationSyntax o => o.ReturnType,
                ConversionOperatorDeclarationSyntax c => c.Type,
                _ => null,
            };

            if (returnType is not IdentifierNameSyntax id) continue;
            // Token.Text keeps the leading @, so an already-escaped `@partial` is "@partial" and skipped.
            if (id.Identifier.Text != "partial") continue;

            // Confirm it resolves to a named type — i.e. it is genuinely being used
            // as a return type, not parsed as a modifier on a partial member.
            if (model.GetTypeInfo(id).Type is not INamedTypeSymbol) continue;

            var pos = id.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Return type named 'partial' must be escaped as '@partial' to remain valid under newer C# rules.");
        }
    }
}
