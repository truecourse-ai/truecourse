using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A concrete (non-abstract) class deriving from System.Attribute that is not
/// `sealed`. Attribute lookup is faster on sealed attributes, and attribute classes
/// are almost never meant to be extended. Needs the base-type chain to confirm it is
/// an Attribute. S4060.
/// </summary>
internal sealed class NonAbstractAttributeNotSealed : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/non-abstract-attribute-not-sealed";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var classDecl in tree.GetRoot().DescendantNodes().OfType<ClassDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(classDecl) is not INamedTypeSymbol type) continue;
            if (type.IsAbstract || type.IsSealed || type.IsStatic) continue;

            // Must transitively derive from System.Attribute.
            if (!InheritsFromAttribute(type)) continue;

            var pos = classDecl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Attribute type '{type.Name}' is not sealed; seal it to speed attribute lookup and signal it is not meant to be extended.");
        }
    }

    private static bool InheritsFromAttribute(INamedTypeSymbol type)
    {
        for (var b = type.BaseType; b is not null; b = b.BaseType)
            if (b.Name == "Attribute" && b.ContainingNamespace?.ToDisplayString() == "System")
                return true;
        return false;
    }
}
