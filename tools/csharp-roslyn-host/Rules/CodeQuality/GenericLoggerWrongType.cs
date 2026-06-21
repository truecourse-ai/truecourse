using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A constructor parameter typed `ILogger<T>` where T is not the type declaring the
/// constructor. The generic argument sets the log category, so a mismatched T routes
/// the type's logs under the wrong category. Needs the resolved generic type argument
/// and the enclosing type. S6672.
/// </summary>
internal sealed class GenericLoggerWrongType : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/generic-logger-wrong-type";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var ctor in tree.GetRoot().DescendantNodes().OfType<ConstructorDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(ctor) is not IMethodSymbol ctorSym) continue;
            var declaring = ctorSym.ContainingType;
            if (declaring is null) continue;

            foreach (var p in ctor.ParameterList.Parameters)
            {
                if (p.Type is null) continue;
                if (model.GetTypeInfo(p.Type).Type is not INamedTypeSymbol pt) continue;

                if (pt.Name != "ILogger") continue;
                if (pt.ContainingNamespace?.ToDisplayString() != "Microsoft.Extensions.Logging") continue;
                if (pt.TypeArguments.Length != 1) continue;

                var arg = pt.TypeArguments[0];
                if (arg.TypeKind == TypeKind.TypeParameter) continue;
                // The category type should be the declaring type (open or closed generic).
                if (SymbolEqualityComparer.Default.Equals(arg.OriginalDefinition, declaring.OriginalDefinition))
                    continue;

                var pos = p.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"ILogger<{arg.Name}> injected into '{declaring.Name}' misattributes the log category; inject ILogger<{declaring.Name}> instead.");
            }
        }
    }
}
