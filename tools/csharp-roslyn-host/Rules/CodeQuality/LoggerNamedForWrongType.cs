using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A logger created with `LoggerFactory.CreateLogger<T>()` (or `.CreateLogger(typeof(T))`)
/// where T is not the type that contains the call. The generic/Type argument sets the
/// log category, so logs land under another type's name. Needs the resolved type
/// argument and the enclosing type.
/// </summary>
internal sealed class LoggerNamedForWrongType : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/logger-named-for-wrong-type";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.Name != "CreateLogger") continue;
            // Must be the logging-framework factory method.
            if (m.ContainingType?.Name is not ("ILoggerFactory" or "LoggerFactory" or "LoggerFactoryExtensions"))
                continue;

            ITypeSymbol? category = null;

            // Generic form: CreateLogger<T>()
            if (m.TypeArguments.Length == 1)
            {
                category = m.TypeArguments[0];
            }
            // Type-argument form: CreateLogger(typeof(T))
            else if (inv.ArgumentList.Arguments is { Count: 1 } args &&
                     args[0].Expression is TypeOfExpressionSyntax to)
            {
                category = model.GetTypeInfo(to.Type).Type;
            }

            if (category is null || category.TypeKind == TypeKind.TypeParameter) continue;

            var enclosing = EnclosingType(inv, model);
            if (enclosing is null) continue;
            if (SymbolEqualityComparer.Default.Equals(category.OriginalDefinition, enclosing.OriginalDefinition))
                continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Logger is named for '{category.Name}' but created inside '{enclosing.Name}'; use the enclosing type so the log category is correct.");
        }
    }

    private static INamedTypeSymbol? EnclosingType(SyntaxNode node, SemanticModel model)
    {
        for (var n = node.Parent; n is not null; n = n.Parent)
            if (n is TypeDeclarationSyntax td)
                return model.GetDeclaredSymbol(td) as INamedTypeSymbol;
        return null;
    }
}
