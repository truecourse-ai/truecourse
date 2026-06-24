using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An ArgumentException (or ArgumentNullException / ArgumentOutOfRangeException)
/// constructed with the message and parameter-name arguments swapped: passing a
/// known parameter name where the message is expected, or vice versa. The two
/// derived hierarchies put the parameter name in opposite constructor positions,
/// so a swap produces a misleading error. Needs overload resolution plus knowledge
/// of the surrounding method's parameter names. CA2208.
/// </summary>
internal sealed class ArgumentExceptionBadArguments : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/argument-exception-bad-arguments";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var oc in tree.GetRoot().DescendantNodes().OfType<ObjectCreationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(oc).Symbol is not IMethodSymbol ctor) continue;
            var exType = ctor.ContainingType;
            if (exType is null) continue;

            // Which Argument*Exception is this?
            var kind = ArgKind(exType);
            if (kind == 0) continue;

            var args = oc.ArgumentList?.Arguments;
            if (args is not { Count: 2 }) continue;

            // The set of parameter names visible at the throw site.
            var paramNames = EnclosingParameterNames(oc, model);
            if (paramNames.Count == 0) continue;

            // For ArgumentException(string message, string paramName) the param-name is
            // the SECOND argument. For ArgumentNullException(string paramName, string message)
            // and ArgumentOutOfRangeException(string paramName, string message) it is FIRST.
            // A finding fires when the SLOT that should hold a param name holds a plain
            // message and the OTHER slot holds a string literal matching a parameter name.
            int paramSlot = kind == 1 ? 1 : 0;   // ArgumentException → slot 1; others → slot 0
            int msgSlot = 1 - paramSlot;

            var paramArg = LiteralText(args.Value[paramSlot].Expression);
            var msgArg = LiteralText(args.Value[msgSlot].Expression);
            if (paramArg is null || msgArg is null) continue;

            // Swapped: the message slot holds a known parameter name, and the param slot does not.
            bool msgIsParamName = paramNames.Contains(msgArg);
            bool paramIsParamName = paramNames.Contains(paramArg);
            if (!msgIsParamName || paramIsParamName) continue;

            var pos = oc.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"{exType.Name} is constructed with the message and parameter-name arguments swapped — '{msgArg}' is a parameter name but sits in the message position. Swap them.");
        }
    }

    // 1 = ArgumentException, 2 = ArgumentNullException / ArgumentOutOfRangeException, 0 = none.
    private static int ArgKind(INamedTypeSymbol type)
    {
        for (var t = type; t is not null; t = t.BaseType)
        {
            if (t.ContainingNamespace is not { Name: "System", ContainingNamespace.IsGlobalNamespace: true })
                continue;
            switch (t.Name)
            {
                case "ArgumentNullException":
                case "ArgumentOutOfRangeException":
                    return 2;
                case "ArgumentException":
                    return 1;
            }
        }
        return 0;
    }

    private static string? LiteralText(ExpressionSyntax expr)
    {
        var e = expr;
        while (e is ParenthesizedExpressionSyntax p) e = p.Expression;
        if (e is LiteralExpressionSyntax lit && lit.Token.ValueText is { Length: > 0 } s)
            return s;
        // nameof(x) yields the simple name `x`.
        if (e is InvocationExpressionSyntax { Expression: IdentifierNameSyntax { Identifier.Text: "nameof" } } inv
            && inv.ArgumentList.Arguments.Count == 1
            && inv.ArgumentList.Arguments[0].Expression is var ne)
            return SimpleName(ne);
        return null;
    }

    private static string? SimpleName(ExpressionSyntax e) => e switch
    {
        IdentifierNameSyntax id => id.Identifier.Text,
        MemberAccessExpressionSyntax ma => ma.Name.Identifier.Text,
        _ => null,
    };

    private static HashSet<string> EnclosingParameterNames(SyntaxNode node, SemanticModel model)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        for (var n = node.Parent; n is not null; n = n.Parent)
        {
            ParameterListSyntax? plist = n switch
            {
                BaseMethodDeclarationSyntax m => m.ParameterList,
                LocalFunctionStatementSyntax lf => lf.ParameterList,
                _ => null,
            };
            if (plist is null) continue;
            foreach (var p in plist.Parameters)
                names.Add(p.Identifier.Text);
            break;
        }
        return names;
    }
}
