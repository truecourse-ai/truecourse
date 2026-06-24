using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A single method or accessor references an unusually large number of distinct types
/// — class-coupling concentrated in one body, indicating low cohesion (the method is
/// doing too much). This is the per-member counterpart to the whole-class measure;
/// emitting at the method level keeps the two from double-flagging the same breadth.
/// Counting distinct resolved types needs the semantic model. CA1506.
/// </summary>
internal sealed class ExcessiveClassCoupling : ISemanticRule
{
    // CA1506 thinks in class-coupling terms; concentrated in one method, 15 distinct
    // collaborator types is already a strong low-cohesion signal.
    private const int MaxDistinctTypesPerMethod = 15;

    public string RuleKey => "architecture/deterministic/excessive-class-coupling";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var member in tree.GetRoot().DescendantNodes().OfType<BaseMethodDeclarationSyntax>())
        {
            var body = (SyntaxNode?)member.Body ?? member.ExpressionBody;
            if (body is null) continue;

            if (model.GetDeclaredSymbol(member) is not IMethodSymbol sym) continue;
            var self = sym.ContainingType;
            if (self is null) continue;

            var count = Coupling.DistinctReferencedTypes(model, body, self);
            if (count <= MaxDistinctTypesPerMethod) continue;

            var nameLoc = NameLocation(member);
            var pos = nameLoc.GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{self.Name}.{sym.Name}' references {count} distinct types (max {MaxDistinctTypesPerMethod}); excessive class coupling in one method signals low cohesion.");
        }
    }

    private static Location NameLocation(BaseMethodDeclarationSyntax member) => member switch
    {
        MethodDeclarationSyntax m => m.Identifier.GetLocation(),
        ConstructorDeclarationSyntax c => c.Identifier.GetLocation(),
        OperatorDeclarationSyntax o => o.OperatorToken.GetLocation(),
        ConversionOperatorDeclarationSyntax cv => cv.Type.GetLocation(),
        _ => member.GetLocation(),
    };
}
