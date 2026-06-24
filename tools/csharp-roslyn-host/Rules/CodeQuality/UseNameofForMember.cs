using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A string literal passed as the parameter-name argument of an argument-exception
/// constructor (ArgumentException, ArgumentNullException, ArgumentOutOfRangeException)
/// whose text matches a parameter of the enclosing method. `nameof(param)` stays in
/// sync across renames; the literal silently rots. Needs symbol resolution to (a)
/// identify the exception's paramName parameter position and (b) confirm a parameter
/// with that exact name is actually in scope. CA1507 / IDE0280.
/// </summary>
internal sealed class UseNameofForMember : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/use-nameof-for-member";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var create in tree.GetRoot().DescendantNodes().OfType<ObjectCreationExpressionSyntax>())
        {
            if (create.ArgumentList is not { } args || args.Arguments.Count == 0) continue;
            if (model.GetSymbolInfo(create).Symbol is not IMethodSymbol ctor) continue;

            // Restrict to the argument-exception family, where one constructor parameter
            // is conventionally the offending parameter name.
            var exType = ctor.ContainingType?.ToDisplayString();
            if (exType is not ("System.ArgumentException" or "System.ArgumentNullException"
                or "System.ArgumentOutOfRangeException")) continue;

            // Find the constructor parameter literally named "paramName" and the literal
            // string passed to it.
            var idx = FindParamNameIndex(ctor);
            if (idx < 0 || idx >= args.Arguments.Count) continue;

            var arg = args.Arguments[idx].Expression;
            if (arg is not LiteralExpressionSyntax lit || !lit.IsKind(SyntaxKind.StringLiteralExpression)) continue;
            var text = lit.Token.ValueText;

            // Only flag when a parameter with exactly that name is visible at this site,
            // so the suggested nameof(...) is guaranteed to compile.
            if (!ParameterInScope(create, text, model)) continue;

            var pos = lit.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Use nameof({text}) instead of the string literal \"{text}\" so the name survives renames.");
        }
    }

    private static int FindParamNameIndex(IMethodSymbol ctor)
    {
        for (var i = 0; i < ctor.Parameters.Length; i++)
            if (ctor.Parameters[i].Name == "paramName") return i;
        return -1;
    }

    /// True if a parameter named `name` is declared on an enclosing method/ctor/local
    /// function / lambda surrounding `site`.
    private static bool ParameterInScope(SyntaxNode site, string name, SemanticModel model)
    {
        for (var n = site.Parent; n is not null; n = n.Parent)
        {
            switch (n)
            {
                case BaseMethodDeclarationSyntax m:
                    return m.ParameterList.Parameters.Any(p => p.Identifier.ValueText == name);
                case LocalFunctionStatementSyntax lf:
                    if (lf.ParameterList.Parameters.Any(p => p.Identifier.ValueText == name)) return true;
                    break;
                case ParenthesizedLambdaExpressionSyntax lam:
                    if (lam.ParameterList.Parameters.Any(p => p.Identifier.ValueText == name)) return true;
                    break;
                case SimpleLambdaExpressionSyntax sl:
                    if (sl.Parameter.Identifier.ValueText == name) return true;
                    break;
            }
        }
        return false;
    }
}
