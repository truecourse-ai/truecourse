using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A property whose getter reads one backing field while its setter assigns a
/// different one — a classic copy-paste bug where the stored value can never be
/// read back. We only fire when both accessors touch exactly one instance field of
/// the declaring type and those fields differ, which keeps us free of false
/// positives on computed/validating accessors.
/// </summary>
internal sealed class GetterSetterWrongField : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/getter-setter-wrong-field";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var prop in tree.GetRoot().DescendantNodes().OfType<PropertyDeclarationSyntax>())
        {
            if (prop.AccessorList is null) continue;
            var getter = prop.AccessorList.Accessors.FirstOrDefault(a => a.Keyword.Text == "get");
            var setter = prop.AccessorList.Accessors.FirstOrDefault(a => a.Keyword.Text == "set");
            if (getter?.Body is null && getter?.ExpressionBody is null) continue;
            if (setter?.Body is null && setter?.ExpressionBody is null) continue;

            if (model.GetDeclaredSymbol(prop) is not IPropertySymbol propSym) continue;
            var type = propSym.ContainingType;
            if (type is null) continue;

            var read = SingleFieldRead(getter, model, type);
            var written = SingleFieldWritten(setter, model, type);
            if (read is null || written is null) continue;
            if (SymbolEqualityComparer.Default.Equals(read, written)) continue;

            // Guard against the legitimate "lazy backing-store" shape where one
            // accessor also references the other's field. If either accessor touches
            // BOTH fields, the mismatch is intentional, so we suppress.
            if (Touches(getter, model, written) || Touches(setter, model, read)) continue;

            var pos = prop.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Property '{propSym.Name}' getter reads field '{((IFieldSymbol)read).Name}' but its setter writes field '{((IFieldSymbol)written).Name}' — the stored value is never read back.");
        }
    }

    /// Returns the single instance field this getter reads, or null if it reads 0 or >1.
    private static ISymbol? SingleFieldRead(AccessorDeclarationSyntax getter, SemanticModel model, INamedTypeSymbol type)
    {
        var node = (SyntaxNode?)getter.Body ?? getter.ExpressionBody;
        if (node is null) return null;
        ISymbol? found = null;
        foreach (var f in InstanceFields(node, model, type))
        {
            if (found is null) found = f;
            else if (!SymbolEqualityComparer.Default.Equals(found, f)) return null;
        }
        return found;
    }

    /// Returns the single instance field assigned in this setter, or null if 0 or >1 distinct.
    private static ISymbol? SingleFieldWritten(AccessorDeclarationSyntax setter, SemanticModel model, INamedTypeSymbol type)
    {
        var node = (SyntaxNode?)setter.Body ?? setter.ExpressionBody;
        if (node is null) return null;
        ISymbol? found = null;
        foreach (var assign in node.DescendantNodesAndSelf().OfType<AssignmentExpressionSyntax>())
        {
            if (model.GetSymbolInfo(assign.Left).Symbol is not IFieldSymbol f) continue;
            if (f.IsStatic || f.IsConst) continue;
            if (!SymbolEqualityComparer.Default.Equals(f.ContainingType, type)) continue;
            if (found is null) found = f;
            else if (!SymbolEqualityComparer.Default.Equals(found, f)) return null;
        }
        return found;
    }

    private static bool Touches(AccessorDeclarationSyntax accessor, SemanticModel model, ISymbol field)
    {
        var node = (SyntaxNode?)accessor.Body ?? accessor.ExpressionBody;
        if (node is null) return false;
        return InstanceFields(node, model, (INamedTypeSymbol)field.ContainingType)
            .Any(f => SymbolEqualityComparer.Default.Equals(f, field));
    }

    private static IEnumerable<IFieldSymbol> InstanceFields(SyntaxNode node, SemanticModel model, INamedTypeSymbol type)
    {
        foreach (var id in node.DescendantNodesAndSelf().OfType<IdentifierNameSyntax>())
        {
            if (model.GetSymbolInfo(id).Symbol is not IFieldSymbol f) continue;
            if (f.IsStatic || f.IsConst) continue;
            if (!SymbolEqualityComparer.Default.Equals(f.ContainingType, type)) continue;
            yield return f;
        }
    }
}
