using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A method parameter that is never read inside the method body. The semantic model
/// is needed to correctly handle implicit interface implementations: a method that
/// implements an interface member has a contract-mandated signature and its parameters
/// cannot be removed — they should at most be renamed to `_`. The tree-sitter variant
/// of this rule cannot detect implicit interface implementations (only explicit ones
/// like `void IFoo.Bar(T x)`), causing false positives on common patterns such as
/// `IFileProvider.GetDirectoryContents(subpath)` or `ILoggerProvider.CreateLogger(categoryName)`.
/// </summary>
internal sealed class UnusedFunctionParameter : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/unused-function-parameter";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var methodDecl in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(methodDecl) is not IMethodSymbol method) continue;

            // Signature-constrained methods: the caller controls the signature.
            if (method.IsOverride || method.IsVirtual || method.IsAbstract ||
                method.IsExtern || method.IsPartialDefinition) continue;
            if (method.MethodKind == MethodKind.ExplicitInterfaceImplementation) continue;

            // Unsafe methods use pointer operations (fixed, stackalloc, address-of)
            // where Roslyn's DataFlowAnalysis does not reliably track parameter reads,
            // producing false positives.
            if (methodDecl.Modifiers.Any(m => m.IsKind(SyntaxKind.UnsafeKeyword))) continue;

            // Implicit interface implementations are equally signature-constrained —
            // the interface mandates every parameter name and type. Removing or
            // renaming a parameter to `_` is the only valid fix, which the developer
            // can choose to do explicitly; we do not flag.
            if (IsImplicitInterfaceImplementation(method)) continue;

            if (method.Name == "Main") continue;
            if (method.Parameters.IsEmpty) continue;

            // Resolve the analysable body node: block-body or expression-body.
            SyntaxNode? analysableBody = methodDecl.Body ?? (SyntaxNode?)methodDecl.ExpressionBody?.Expression;
            if (analysableBody == null) continue;

            if (methodDecl.Body is { } block)
            {
                if (block.Statements.Count == 0) continue; // intentional stub
                var bodyText = block.ToFullString();
                if (bodyText.Contains("NotImplementedException") ||
                    bodyText.Contains("NotSupportedException")) continue;
            }

            // DataFlowAnalysis gives us the exact set of symbols read inside the body —
            // far more precise than text-matching identifiers.
            var dataFlow = analysableBody is BlockSyntax blockBody
                ? model.AnalyzeDataFlow(blockBody)
                : model.AnalyzeDataFlow((ExpressionSyntax)analysableBody);
            if (dataFlow == null || !dataFlow.Succeeded) continue;

            var readSymbols = dataFlow.ReadInside;

            foreach (var param in method.Parameters)
            {
                if (param.Name.StartsWith("_", StringComparison.Ordinal)) continue;
                if (param.IsThis) continue; // extension-method receiver
                if (param.RefKind is RefKind.Out or RefKind.Ref) continue;
                // CancellationToken is a convention contract in async APIs.
                if (param.Type.Name == "CancellationToken") continue;
                // Event-handler shape: (object sender, XxxEventArgs e).
                if (IsEventHandlerShape(method, model)) continue;

                if (!readSymbols.Contains(param, SymbolEqualityComparer.Default))
                {
                    var loc = param.Locations.FirstOrDefault();
                    if (loc == null) continue;
                    var pos = loc.GetLineSpan().StartLinePosition;
                    yield return new Violation(
                        RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                        $"Unused parameter `{param.Name}` — remove it or rename to `_{param.Name}` if the signature is fixed.");
                }
            }
        }
    }

    private static bool IsImplicitInterfaceImplementation(IMethodSymbol method)
    {
        var containingType = method.ContainingType;
        return containingType.AllInterfaces
            .SelectMany(i => i.GetMembers(method.Name).OfType<IMethodSymbol>())
            .Any(im => SymbolEqualityComparer.Default.Equals(
                containingType.FindImplementationForInterfaceMember(im), method));
    }

    private static bool IsEventHandlerShape(IMethodSymbol method, SemanticModel model)
    {
        if (method.Parameters.Length != 2) return false;
        var first = method.Parameters[0];
        var second = method.Parameters[1];
        if (first.Type.SpecialType != SpecialType.System_Object) return false;
        // Second parameter must be EventArgs or a subclass.
        var eventArgsType = model.Compilation.GetTypeByMetadataName("System.EventArgs");
        if (eventArgsType == null) return false;
        var secondType = second.Type;
        while (secondType != null)
        {
            if (SymbolEqualityComparer.Default.Equals(secondType, eventArgsType)) return true;
            secondType = secondType.BaseType;
        }
        return false;
    }
}
