using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An explicit value passed for a parameter marked with a caller-info attribute
/// ([CallerMemberName], [CallerLineNumber], [CallerFilePath], [CallerArgumentExpression]).
/// Supplying it overrides the value the compiler would otherwise inject, which is
/// almost always unintended. We resolve the call and map each supplied argument to its
/// target parameter to see whether that parameter carries a caller-info attribute.
/// Needs overload resolution and parameter attributes.
/// </summary>
internal sealed class ExplicitCallerInfoArgument : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/explicit-caller-info-argument";

    private static readonly string[] CallerAttributes =
    {
        "CallerMemberNameAttribute",
        "CallerLineNumberAttribute",
        "CallerFilePathAttribute",
        "CallerArgumentExpressionAttribute",
    };

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            var ps = m.Parameters;
            if (ps.Length == 0) continue;

            var args = inv.ArgumentList.Arguments;
            for (int i = 0; i < args.Count; i++)
            {
                var arg = args[i];
                IParameterSymbol? target;
                if (arg.NameColon is { } nc)
                    target = ps.FirstOrDefault(p => p.Name == nc.Name.Identifier.Text);
                else
                    target = i < ps.Length ? ps[i] : (ps[^1].IsParams ? ps[^1] : null);
                if (target is null) continue;

                var attrName = CallerInfoAttribute(target);
                if (attrName is null) continue;

                var pos = arg.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Explicit value passed for '{target.Name}', a [{attrName}] parameter — this overrides the compiler-supplied caller information. Omit the argument.");
            }
        }
    }

    private static string? CallerInfoAttribute(IParameterSymbol p)
    {
        foreach (var a in p.GetAttributes())
        {
            var n = a.AttributeClass?.Name;
            if (n is not null && Array.IndexOf(CallerAttributes, n) >= 0 &&
                a.AttributeClass!.ContainingNamespace.ToDisplayString() == "System.Runtime.CompilerServices")
                return n;
        }
        return null;
    }
}
