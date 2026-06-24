using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A class sits too many levels deep in its total base-class chain (counting every
/// ancestor up to, but excluding, System.Object). A long ancestry makes the effective
/// behavior of an instance hard to follow. Needs the semantic model to resolve each
/// base type — including ones declared in other analyzed files or referenced
/// assemblies — into its own base. CA1501.
/// </summary>
internal sealed class DeepInheritanceChain : ISemanticRule
{
    // CA1501 default: flag at a depth of 6 or more (System.Object excluded).
    private const int MaxDepth = 5;

    public string RuleKey => "architecture/deterministic/deep-inheritance-chain";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var decl in tree.GetRoot().DescendantNodes().OfType<ClassDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(decl) is not INamedTypeSymbol type) continue;

            var depth = 0;
            for (var b = type.BaseType; b is not null && b.SpecialType != SpecialType.System_Object; b = b.BaseType)
                depth++;

            if (depth <= MaxDepth) continue;

            var pos = decl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{type.Name}' is {depth} levels deep in its inheritance chain (max {MaxDepth}); deep hierarchies make the effective behavior hard to follow.");
        }
    }
}
