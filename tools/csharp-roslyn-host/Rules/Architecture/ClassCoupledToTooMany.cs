using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A class references an excessive number of distinct other types across all its
/// members — a high efferent-coupling signal. Such a type knows about too much of the
/// system and is fragile to change. Resolving how many *distinct* types are touched
/// (deduping generics, ignoring primitives and self-references) needs the semantic
/// model. S1200.
/// </summary>
internal sealed class ClassCoupledToTooMany : ISemanticRule
{
    // SonarQube S1200 default coupling threshold is 20 distinct classes.
    private const int MaxDistinctTypes = 20;

    public string RuleKey => "architecture/deterministic/class-coupled-to-too-many";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var decl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (decl is not (ClassDeclarationSyntax or RecordDeclarationSyntax or StructDeclarationSyntax)) continue;
            if (model.GetDeclaredSymbol(decl) is not INamedTypeSymbol self) continue;

            var count = Coupling.DistinctReferencedTypes(model, decl, self);
            if (count <= MaxDistinctTypes) continue;

            var pos = decl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{self.Name}' references {count} distinct types (max {MaxDistinctTypes}); high efferent coupling makes it fragile and hard to maintain.");
        }
    }
}
