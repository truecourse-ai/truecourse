using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An event declared with a custom, user-defined delegate whose signature breaks
/// the <c>(object sender, TEventArgs e)</c> convention — the first parameter is not
/// <c>object</c>, the second does not derive from <c>EventArgs</c>, or the arity is
/// wrong. Handlers and generic subscribers (<c>+=</c> wiring, designer tooling,
/// weak-event managers) rely on that shape, so a divergent one breaks interop and
/// reuse. Deliberately non-conventional event delegates — <c>EventHandler</c>,
/// <c>EventHandler&lt;T&gt;</c>, and <c>Action</c>/<c>Func</c> — are left alone; only
/// a hand-written delegate that clearly intends to be an event handler but gets the
/// shape wrong is flagged, keeping this false-positive free.
/// </summary>
internal sealed class EventHandlerWrongSignature : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/event-handler-wrong-signature";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var node in tree.GetRoot().DescendantNodes())
        {
            TypeSyntax? typeSyntax = node switch
            {
                EventFieldDeclarationSyntax f => f.Declaration.Type,
                EventDeclarationSyntax e => e.Type,
                _ => null,
            };
            if (typeSyntax is null) continue;

            if (model.GetSymbolInfo(typeSyntax).Symbol is not INamedTypeSymbol { TypeKind: TypeKind.Delegate } del) continue;
            if (!IsUserDefinedHandlerDelegate(del)) continue;

            var invoke = del.DelegateInvokeMethod;
            if (invoke is null) continue;

            var ps = invoke.Parameters;
            var conforms = ps.Length == 2
                && ps[0].Type.SpecialType == SpecialType.System_Object
                && DerivesFromEventArgs(ps[1].Type);
            if (conforms) continue;

            var pos = typeSyntax.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Event delegate '{del.Name}' does not follow the (object sender, TEventArgs e) convention — handlers and tooling expect that shape.");
        }
    }

    /// <summary>
    /// A delegate the author wrote to be an event handler: declared outside the BCL
    /// and not one of the framework delegates that intentionally differ
    /// (EventHandler/EventHandler&lt;T&gt;, Action, Func).
    /// </summary>
    private static bool IsUserDefinedHandlerDelegate(INamedTypeSymbol del)
    {
        if (del.Name is "EventHandler" or "Action" or "Func") return false;
        var ns = del.ContainingNamespace?.ToDisplayString() ?? string.Empty;
        return ns != "System" && !ns.StartsWith("System.");
    }

    private static bool DerivesFromEventArgs(ITypeSymbol type)
    {
        for (var t = type; t is not null; t = t.BaseType)
            if (t.Name == "EventArgs" && t.ContainingNamespace?.ToDisplayString() == "System") return true;
        return false;
    }
}
