using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// Assigning a derived-element array to a base-element array reference. Arrays are
/// covariant in C#, so this compiles, but a later store of a base instance throws
/// ArrayTypeMismatchException at runtime. Needs the element types to compare the
/// reference-type chain (struct arrays are invariant and never affected).
/// </summary>
internal sealed class ArrayCovariance : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/array-covariance";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var node in tree.GetRoot().DescendantNodes())
        {
            ITypeSymbol? target = null;
            ExpressionSyntax? source = null;

            switch (node)
            {
                case AssignmentExpressionSyntax a when a.IsKind(Microsoft.CodeAnalysis.CSharp.SyntaxKind.SimpleAssignmentExpression):
                    target = model.GetTypeInfo(a.Left).Type;
                    source = a.Right;
                    break;
                case VariableDeclaratorSyntax { Initializer: { } init, Parent: VariableDeclarationSyntax decl }:
                    // skip 'var' — the inferred type matches the source exactly
                    if (decl.Type.IsVar) continue;
                    target = model.GetTypeInfo(decl.Type).Type;
                    source = init.Value;
                    break;
                default:
                    continue;
            }

            if (target is not IArrayTypeSymbol { ElementType: { IsReferenceType: true } targetElem } || source is null)
                continue;

            var srcType = model.GetTypeInfo(source).Type;
            if (srcType is not IArrayTypeSymbol { ElementType: { IsReferenceType: true } srcElem })
                continue;

            // Covariant misuse = source element strictly derives from target element.
            if (SymbolEqualityComparer.Default.Equals(srcElem, targetElem)) continue;
            if (!DerivesFrom(srcElem, targetElem)) continue;

            var pos = source.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Array covariance: a {srcElem.Name}[] is assigned to a {targetElem.Name}[] reference; storing a {targetElem.Name} into it throws ArrayTypeMismatchException.");
        }
    }

    private static bool DerivesFrom(ITypeSymbol derived, ITypeSymbol baseType)
    {
        for (var b = derived.BaseType; b is not null; b = b.BaseType)
            if (SymbolEqualityComparer.Default.Equals(b, baseType)) return true;
        return false;
    }
}
