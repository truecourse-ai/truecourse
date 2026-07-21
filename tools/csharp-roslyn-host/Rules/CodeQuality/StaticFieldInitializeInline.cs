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
/// CA1810.
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

            // The beforefieldinit win only materializes if inlining removes the ENTIRE
            // static constructor. That requires every statement in it to be a simple
            // assignment to a distinct static field of this type. If the cctor does
            // anything else — a loop, a method call, a local, a multi-statement build,
            // or member mutation of an already-assigned field — it stays regardless, so
            // inlining any single field yields no beforefieldinit benefit and is a false
            // positive. Skip the whole type in that case.
            if (!StaticCtorFullyLiftable(type, body, model)) continue;

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

    /// <summary>
    /// True iff the static constructor could be dropped entirely by inlining: every
    /// statement is a simple assignment to a *distinct* static field of this type
    /// (each such field assigned exactly once), and there is at least one. Any other
    /// statement — a loop, a call, a local, member mutation, or a re-assignment —
    /// means the cctor survives and no beforefieldinit is gained.
    /// </summary>
    private static bool StaticCtorFullyLiftable(TypeDeclarationSyntax type, BlockSyntax body, SemanticModel model)
    {
        if (model.GetDeclaredSymbol(type) is not INamedTypeSymbol typeSymbol) return false;

        var assigned = new HashSet<IFieldSymbol>(SymbolEqualityComparer.Default);
        foreach (var stmt in body.Statements)
        {
            if (stmt is not ExpressionStatementSyntax { Expression: AssignmentExpressionSyntax assign }) return false;
            if (!assign.IsKind(SyntaxKind.SimpleAssignmentExpression)) return false;

            var target = assign.Left switch
            {
                MemberAccessExpressionSyntax ma => ma.Name,
                IdentifierNameSyntax id => (SimpleNameSyntax)id,
                _ => null,
            };
            if (target is null) return false;
            if (model.GetSymbolInfo(target).Symbol is not IFieldSymbol f) return false;
            if (!f.IsStatic) return false;
            if (!SymbolEqualityComparer.Default.Equals(f.ContainingType, typeSymbol)) return false;
            if (!assigned.Add(f)) return false; // assigned more than once → not a single inline initializer
        }

        return body.Statements.Count > 0;
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
