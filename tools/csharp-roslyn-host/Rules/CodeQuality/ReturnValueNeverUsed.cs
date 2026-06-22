using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A private method that returns a value, is called at least once, and whose return
/// value is discarded at every call site in the compilation. Since the type is
/// private the compilation sees all callers, so the method should return void.
/// Needs whole-compilation symbol resolution to find every invocation and classify
/// whether the result is consumed.
/// </summary>
internal sealed class ReturnValueNeverUsed : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/return-value-never-used";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(method) is not IMethodSymbol sym) continue;

            // Only PRIVATE methods: a wider accessibility means unseen callers could use
            // the result. Skip async (return shape is the awaitable contract), iterators,
            // partial/extern (no body to reason about), overrides and interface impls
            // (the signature is fixed by the base), and operators/ctors.
            if (sym.DeclaredAccessibility != Accessibility.Private) continue;
            if (sym.ReturnsVoid) continue;
            if (sym.IsAsync || sym.IsOverride || sym.IsVirtual || sym.IsExtern) continue;
            if (sym.MethodKind != MethodKind.Ordinary) continue;
            if (method.Modifiers.Any(SyntaxKind.PartialKeyword)) continue;
            if (ImplementsInterface(sym)) continue;

            var (found, allDiscarded) = AllCallsDiscardResult(sym, model.Compilation);
            if (!found || !allDiscarded) continue;

            var pos = method.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Private method '{sym.Name}' returns a value that is discarded at every call site; change its return type to void.");
        }
    }

    private static bool ImplementsInterface(IMethodSymbol sym)
    {
        var type = sym.ContainingType;
        if (type is null) return false;
        foreach (var iface in type.AllInterfaces)
            foreach (var member in iface.GetMembers().OfType<IMethodSymbol>())
                if (SymbolEqualityComparer.Default.Equals(type.FindImplementationForInterfaceMember(member), sym))
                    return true;
        return false;
    }

    /// Scans every invocation of `method` across the compilation. Returns
    /// (anyCallSeen, everyResultDiscarded). A "discarded" result is an invocation
    /// used as a bare statement expression or as the right side of a discard `_ = …`.
    private static (bool found, bool allDiscarded) AllCallsDiscardResult(IMethodSymbol method, Compilation compilation)
    {
        var found = false;
        foreach (var typeRef in method.ContainingType!.DeclaringSyntaxReferences)
        {
            var node = typeRef.GetSyntax();
            var model = compilation.GetSemanticModel(node.SyntaxTree);
            foreach (var inv in node.DescendantNodes().OfType<InvocationExpressionSyntax>())
            {
                if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol called) continue;
                if (!SymbolEqualityComparer.Default.Equals(called.OriginalDefinition, method.OriginalDefinition)) continue;
                found = true;
                if (!ResultIsDiscarded(inv)) return (true, false);
            }
        }
        return (found, found);
    }

    private static bool ResultIsDiscarded(InvocationExpressionSyntax inv)
    {
        switch (inv.Parent)
        {
            // `Foo();` as a standalone statement.
            case ExpressionStatementSyntax:
                return true;
            // `_ = Foo();` — explicit discard.
            case AssignmentExpressionSyntax assign
                when assign.IsKind(SyntaxKind.SimpleAssignmentExpression)
                  && assign.Right == inv
                  && assign.Left is IdentifierNameSyntax { Identifier.ValueText: "_" }:
                return true;
            default:
                return false;
        }
    }
}
