using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `Trace.WriteLineIf` whose condition compares a `TraceSwitch` level
/// (`switch.TraceError`, `switch.Level == TraceLevel.X`, …). `TraceSwitch` exposes
/// boolean `TraceError`/`TraceWarning`/`TraceInfo`/`TraceVerbose` properties for this
/// purpose; comparing `Level` by hand double-evaluates the level and is error-prone.
/// We resolve the call to `System.Diagnostics.Trace.WriteLineIf` and inspect the first
/// argument for a `TraceSwitch`-typed `Level` comparison. S6675.
/// </summary>
internal sealed class TraceSwitchWriteLineIfMisuse : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/traceswitch-writelineif-misuse";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.Name != "WriteLineIf") continue;
            var owner = m.ContainingType?.ToDisplayString();
            if (owner != "System.Diagnostics.Trace" && owner != "System.Diagnostics.Debug") continue;

            var args = inv.ArgumentList.Arguments;
            if (args.Count == 0) continue;

            if (!ComparesTraceSwitchLevel(args[0].Expression, model)) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "WriteLineIf gates on a TraceSwitch Level comparison; use the switch's TraceError/TraceWarning/TraceInfo/TraceVerbose boolean instead.");
        }
    }

    private static bool ComparesTraceSwitchLevel(ExpressionSyntax condition, SemanticModel model)
    {
        // Look for any `<traceSwitch>.Level` member access inside the condition whose
        // receiver resolves to System.Diagnostics.TraceSwitch.
        foreach (var access in condition.DescendantNodesAndSelf().OfType<MemberAccessExpressionSyntax>())
        {
            if (access.Name.Identifier.ValueText != "Level") continue;
            if (model.GetTypeInfo(access.Expression).Type is not { } recv) continue;
            if (IsTraceSwitch(recv)) return true;
        }
        return false;
    }

    private static bool IsTraceSwitch(ITypeSymbol type)
    {
        for (var t = type; t is not null; t = t.BaseType)
            if (t.ToDisplayString() == "System.Diagnostics.TraceSwitch")
                return true;
        return false;
    }
}
