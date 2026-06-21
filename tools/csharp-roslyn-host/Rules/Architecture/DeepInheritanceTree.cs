using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A class extends a chain of base classes that are themselves part of this codebase
/// — i.e. the project-authored inheritance depth is excessive. Unlike CA1501 (which
/// counts every ancestor including framework types), this counts only base classes
/// declared in the analyzed source, so deriving deeply from a framework base (e.g. a
/// long WPF/ASP.NET chain) is not penalized while a home-grown tower is. Needs the
/// semantic model to walk resolved base types and inspect their declaring source. S110.
/// </summary>
internal sealed class DeepInheritanceTree : ISemanticRule
{
    // S110 default maximumDepth is 5: flag at 6+ source-authored base classes.
    private const int MaxDepth = 5;

    public string RuleKey => "architecture/deterministic/deep-inheritance-tree";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var decl in tree.GetRoot().DescendantNodes().OfType<ClassDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(decl) is not INamedTypeSymbol type) continue;

            var depth = 0;
            for (var b = type.BaseType; b is not null && b.SpecialType != SpecialType.System_Object; b = b.BaseType)
            {
                // Count only base classes the user authored (have source). A base type
                // pulled in from a referenced assembly contributes nothing to the
                // home-grown inheritance tree this rule measures.
                if (b.DeclaringSyntaxReferences.Length > 0) depth++;
            }

            if (depth <= MaxDepth) continue;

            var pos = decl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{type.Name}' derives through {depth} project-defined base classes (max {MaxDepth}); the inheritance tree is too deep and fragile.");
        }
    }
}
