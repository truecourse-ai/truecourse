using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An instance method that never touches its receiver — no `this`, no unqualified
/// access to any instance member of the declaring type. The method does not depend
/// on instance state and could be `static`, or it belongs elsewhere. Needs symbol
/// resolution to classify every unqualified name as instance vs. static. RCS1175.
/// </summary>
internal sealed class UnusedThisParameter : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/unused-this-parameter";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(method) is not IMethodSymbol sym) continue;
            if (sym.IsStatic) continue;
            // Overrides, virtual/abstract members, and interface implementations are
            // contractually instance-bound — making them static is not an option.
            if (sym.IsVirtual || sym.IsOverride || sym.IsAbstract) continue;
            if (sym.ExplicitInterfaceImplementations.Length > 0 || ImplementsInterface(sym)) continue;
            // Extension methods already declare `this`; a separate rule covers those.
            if (sym.IsExtensionMethod) continue;
            // No body (abstract/partial/extern) — nothing to analyze.
            if (method.Body is null && method.ExpressionBody is null) continue;
            // Require at least one parameter: a parameterless instance method that ignores
            // `this` is often a lifecycle/event hook (noisy to flag), whereas a method that
            // takes inputs and ignores the receiver is the clear "should be static" smell.
            if (sym.Parameters.Length == 0) continue;

            if (!UsesInstanceState(method, sym, model))
            {
                var pos = method.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Method '{sym.Name}' never uses instance state; mark it static or move it to where the data lives.");
            }
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

    private static bool UsesInstanceState(MethodDeclarationSyntax method, IMethodSymbol sym, SemanticModel model)
    {
        SyntaxNode? bodyNode = (SyntaxNode?)method.Body ?? method.ExpressionBody;
        if (bodyNode is null) return false;
        var type = sym.ContainingType;

        foreach (var node in bodyNode.DescendantNodesAndSelf())
        {
            switch (node)
            {
                case ThisExpressionSyntax:
                case BaseExpressionSyntax:
                    return true;
                case IdentifierNameSyntax id:
                    // Skip the right-hand name of a member access (`x.Foo`) — that's
                    // qualified and resolved via the receiver, not the implicit `this`.
                    if (id.Parent is MemberAccessExpressionSyntax ma && ma.Name == id) break;
                    var symbol = model.GetSymbolInfo(id).Symbol;
                    if (symbol is null) break;
                    if (symbol.IsStatic) break;
                    // An unqualified instance field/property/method/event of THIS type
                    // (or a base) means the method depends on the receiver.
                    if (symbol is IFieldSymbol or IPropertySymbol or IEventSymbol
                        || (symbol is IMethodSymbol { MethodKind: MethodKind.Ordinary }))
                    {
                        if (symbol.ContainingType is { } owner && InheritsFrom(type, owner))
                            return true;
                    }
                    break;
            }
        }
        return false;
    }

    private static bool InheritsFrom(INamedTypeSymbol? type, INamedTypeSymbol owner)
    {
        for (var t = type; t is not null; t = t.BaseType)
            if (SymbolEqualityComparer.Default.Equals(t, owner)) return true;
        return false;
    }
}
