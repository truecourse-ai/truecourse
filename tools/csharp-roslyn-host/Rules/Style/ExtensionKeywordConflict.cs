using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A declared identifier literally named <c>extension</c>. C# 14 introduces
/// <c>extension</c> as a contextual keyword (extension blocks); an unescaped
/// identifier of that name will collide and must be written <c>@extension</c>.
/// We flag only declaration sites (types, members, parameters, locals) so a use of
/// a correctly-escaped name elsewhere is unaffected.
/// </summary>
internal sealed class ExtensionKeywordConflict : ISemanticRule
{
    public string RuleKey => "style/deterministic/extension-keyword-conflict";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var token in tree.GetRoot().DescendantTokens())
        {
            if (!token.IsKind(SyntaxKind.IdentifierToken)) continue;
            // ValueText strips the leading @, so `@extension` is filtered out by
            // checking the raw token text still carries the escape.
            if (token.ValueText != "extension") continue;
            if (token.Text.StartsWith('@')) continue;
            if (!IsDeclarationIdentifier(token)) continue;

            var pos = token.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Identifier 'extension' collides with the C# 14 contextual keyword — rename it or escape it as '@extension'.");
        }
    }

    private static bool IsDeclarationIdentifier(SyntaxToken token)
    {
        var parent = token.Parent;
        return parent switch
        {
            BaseTypeDeclarationSyntax t => t.Identifier == token,
            DelegateDeclarationSyntax d => d.Identifier == token,
            MethodDeclarationSyntax m => m.Identifier == token,
            PropertyDeclarationSyntax p => p.Identifier == token,
            EventDeclarationSyntax e => e.Identifier == token,
            VariableDeclaratorSyntax v => v.Identifier == token,
            ParameterSyntax pa => pa.Identifier == token,
            EnumMemberDeclarationSyntax em => em.Identifier == token,
            SingleVariableDesignationSyntax sv => sv.Identifier == token,
            ForEachStatementSyntax fe => fe.Identifier == token,
            TypeParameterSyntax tp => tp.Identifier == token,
            LocalFunctionStatementSyntax lf => lf.Identifier == token,
            _ => false,
        };
    }
}
