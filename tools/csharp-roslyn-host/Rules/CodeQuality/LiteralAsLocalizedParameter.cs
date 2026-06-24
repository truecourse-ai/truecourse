using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A non-empty string literal passed to a parameter that is explicitly marked
/// `[Localizable(true)]` — the framework's signal that the argument is user-facing
/// text that should come from a resource, not be hardcoded. Hardcoding it ships an
/// untranslated string. We resolve the target parameter and require an explicit
/// `LocalizableAttribute(true)`, so only parameters the author opted into localizing
/// are flagged.
/// </summary>
internal sealed class LiteralAsLocalizedParameter : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/literal-as-localized-parameter";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var arg in tree.GetRoot().DescendantNodes().OfType<ArgumentSyntax>())
        {
            // Only a bare string literal is a hardcoded value; expressions/resource
            // lookups are fine.
            if (arg.Expression is not LiteralExpressionSyntax lit) continue;
            if (!lit.IsKind(Microsoft.CodeAnalysis.CSharp.SyntaxKind.StringLiteralExpression)) continue;
            if (string.IsNullOrWhiteSpace(lit.Token.ValueText)) continue;

            var param = ResolveParameter(arg, model);
            if (param is null) continue;
            if (!IsLocalizable(param)) continue;

            var pos = lit.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"A hardcoded string literal is passed to the localizable parameter '{param.Name}'; supply localized/resource text instead.");
        }
    }

    private static IParameterSymbol? ResolveParameter(ArgumentSyntax arg, SemanticModel model)
    {
        if (arg.Parent is not BaseArgumentListSyntax list) return null;
        if (list.Parent is null) return null;

        var symbol = model.GetSymbolInfo(list.Parent).Symbol as IMethodSymbol;
        if (symbol is null) return null;

        // Named argument binds by name.
        if (arg.NameColon is { } nc)
            return symbol.Parameters.FirstOrDefault(p => p.Name == nc.Name.Identifier.ValueText);

        var index = list.Arguments.IndexOf(arg);
        if (index < 0) return null;
        if (index < symbol.Parameters.Length) return symbol.Parameters[index];
        // Trailing args fold into a params parameter.
        var last = symbol.Parameters.LastOrDefault();
        return last is { IsParams: true } ? last : null;
    }

    private static bool IsLocalizable(IParameterSymbol param)
    {
        foreach (var attr in param.GetAttributes())
        {
            if (attr.AttributeClass?.ToDisplayString() != "System.ComponentModel.LocalizableAttribute")
                continue;
            // [Localizable(true)] — the single positional bool must be true.
            if (attr.ConstructorArguments.Length == 1
                && attr.ConstructorArguments[0].Value is bool b)
                return b;
        }
        return false;
    }
}
