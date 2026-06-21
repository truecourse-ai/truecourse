using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A static field with no inline initializer that is assigned exactly once, in an
/// explicit static constructor, by a simple `field = <expr>;` statement. Inlining
/// the initializer is simpler and — crucially — lets the runtime mark the type
/// `beforefieldinit`, relaxing initialization timing. The presence of an explicit
/// static constructor blocks that optimization. Needs symbol resolution to match
/// the assignment target to the field and to confirm the only write is in the cctor.
/// S3963 / CA1810.
/// </summary>
internal sealed class StaticFieldInitializeInline : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/static-field-initialize-inline";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var type in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            var cctor = type.Members.OfType<ConstructorDeclarationSyntax>()
                .FirstOrDefault(c => c.Modifiers.Any(SyntaxKind.StaticKeyword));
            if (cctor?.Body is not { } body) continue;

            // Inspect every static field declared on this type with no initializer.
            foreach (var fieldDecl in type.Members.OfType<FieldDeclarationSyntax>())
            {
                if (!fieldDecl.Modifiers.Any(SyntaxKind.StaticKeyword)) continue;
                if (fieldDecl.Modifiers.Any(SyntaxKind.ConstKeyword)) continue;

                foreach (var v in fieldDecl.Declaration.Variables)
                {
                    if (v.Initializer is not null) continue;
                    if (model.GetDeclaredSymbol(v) is not IFieldSymbol field) continue;

                    if (OnlyAssignedOnceInCctorBody(field, body, model))
                    {
                        var pos = v.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                        yield return new Violation(
                            RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                            $"Static field '{field.Name}' is assigned only in the static constructor; initialize it inline so the type can be marked beforefieldinit.");
                    }
                }
            }
        }
    }

    /// True iff exactly one statement in the cctor body is a simple assignment whose
    /// left side is `field` (or `Type.field` / `this`-less member access), and no other
    /// statement references the field as a write. Simple assignment only — compound
    /// (`+=`) or conditional writes can't be lifted to an initializer.
    private static bool OnlyAssignedOnceInCctorBody(IFieldSymbol field, BlockSyntax body, SemanticModel model)
    {
        var writes = 0;
        foreach (var assign in body.DescendantNodes().OfType<AssignmentExpressionSyntax>())
        {
            if (!assign.IsKind(SyntaxKind.SimpleAssignmentExpression)) continue;
            var target = assign.Left switch
            {
                MemberAccessExpressionSyntax ma => ma.Name,
                IdentifierNameSyntax id => (SimpleNameSyntax)id,
                _ => null,
            };
            if (target is null) continue;
            if (model.GetSymbolInfo(target).Symbol is not IFieldSymbol f) continue;
            if (!SymbolEqualityComparer.Default.Equals(f, field)) continue;
            writes++;
        }

        if (writes != 1) return false;

        // The single assignment must be a top-level statement of the cctor (not nested in
        // a loop/if/try), so it is unconditional and liftable.
        var topLevel = body.Statements
            .OfType<ExpressionStatementSyntax>()
            .Select(s => s.Expression)
            .OfType<AssignmentExpressionSyntax>()
            .Any(a => IsWriteTo(a, field, model));
        return topLevel;
    }

    private static bool IsWriteTo(AssignmentExpressionSyntax assign, IFieldSymbol field, SemanticModel model)
    {
        if (!assign.IsKind(SyntaxKind.SimpleAssignmentExpression)) return false;
        var target = assign.Left switch
        {
            MemberAccessExpressionSyntax ma => ma.Name,
            IdentifierNameSyntax id => (SimpleNameSyntax)id,
            _ => null,
        };
        if (target is null) return false;
        return model.GetSymbolInfo(target).Symbol is IFieldSymbol f
            && SymbolEqualityComparer.Default.Equals(f, field);
    }
}
