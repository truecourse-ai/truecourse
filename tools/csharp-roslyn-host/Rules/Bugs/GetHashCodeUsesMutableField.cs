using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An override of GetHashCode reads a non-readonly instance field of the same type.
/// If that field is mutated after the object is used as a dictionary/hashset key,
/// the hash changes and the entry is lost. Needs symbol resolution to confirm the
/// referenced symbol is a mutable field of the declaring type.
/// </summary>
internal sealed class GetHashCodeUsesMutableField : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/gethashcode-uses-mutable-field";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (method.Identifier.Text != "GetHashCode") continue;
            if (method.ParameterList.Parameters.Count != 0) continue;
            if (model.GetDeclaredSymbol(method) is not IMethodSymbol sym) continue;
            if (!sym.IsOverride) continue;

            var type = sym.ContainingType;
            if (type is null) continue;

            var body = (SyntaxNode?)method.Body ?? method.ExpressionBody;
            if (body is null) continue;

            var reported = new HashSet<string>();
            foreach (var id in body.DescendantNodes().OfType<IdentifierNameSyntax>())
            {
                if (model.GetSymbolInfo(id).Symbol is not IFieldSymbol f) continue;
                if (f.IsReadOnly || f.IsConst || f.IsStatic) continue;
                if (!SymbolEqualityComparer.Default.Equals(f.ContainingType, type)) continue;
                if (!reported.Add(f.Name)) continue;

                var pos = id.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"GetHashCode derives from mutable field '{f.Name}' — mutating it after the object is used as a key corrupts the hash table. Use only readonly fields.");
            }
        }
    }
}
