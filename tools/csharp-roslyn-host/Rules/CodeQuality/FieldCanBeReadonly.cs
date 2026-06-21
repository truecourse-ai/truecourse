using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A private instance field that is assigned only in its declaration initializer
/// and/or inside a constructor of the declaring type, and never reassigned anywhere
/// else, so it can be `readonly`. Needs full symbol resolution to find every write
/// site across the compilation and to distinguish reads from writes. IDE0044/RCS1169.
/// </summary>
internal sealed class FieldCanBeReadonly : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/field-can-be-readonly";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var fieldDecl in tree.GetRoot().DescendantNodes().OfType<FieldDeclarationSyntax>())
        {
            var mods = fieldDecl.Modifiers;
            if (mods.Any(SyntaxKind.ReadOnlyKeyword) ||
                mods.Any(SyntaxKind.ConstKeyword) ||
                mods.Any(SyntaxKind.StaticKeyword) ||
                mods.Any(SyntaxKind.VolatileKeyword)) continue;
            // Only private fields: anything more visible can be written by other types
            // we may not see, and partial types can split writes across files. Private
            // keeps the analysis sound and conservative.
            if (!mods.Any(SyntaxKind.PrivateKeyword)) continue;

            foreach (var v in fieldDecl.Declaration.Variables)
            {
                if (model.GetDeclaredSymbol(v) is not IFieldSymbol field) continue;
                if (field.ContainingType is not { } type) continue;
                if (type.TypeKind is not (TypeKind.Class or TypeKind.Struct)) continue;
                // Reference-type structs/ref structs and fixed-size buffers complicate
                // readonly semantics; skip ref structs to stay safe.
                if (type.IsRefLikeType) continue;

                if (CanBeReadonly(field, type, model.Compilation))
                {
                    var pos = v.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                    yield return new Violation(
                        RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                        $"Private field '{field.Name}' is only assigned in its declaration or a constructor and never reassigned; mark it readonly.");
                }
            }
        }
    }

    /// True iff every assignment to `field` is either its inline initializer or sits
    /// inside an instance constructor of `type`, AND it is never passed by ref/out.
    private static bool CanBeReadonly(IFieldSymbol field, INamedTypeSymbol type, Compilation compilation)
    {
        var anyAssignment = field.DeclaringSyntaxReferences.Any(
            r => r.GetSyntax() is VariableDeclaratorSyntax { Initializer: not null });

        // Examine every syntax tree where the declaring type could be defined.
        foreach (var typeRef in type.DeclaringSyntaxReferences)
        {
            var typeNode = typeRef.GetSyntax();
            var model = compilation.GetSemanticModel(typeNode.SyntaxTree);

            foreach (var id in typeNode.DescendantNodes().OfType<SimpleNameSyntax>())
            {
                if (model.GetSymbolInfo(id).Symbol is not IFieldSymbol referenced) continue;
                if (!SymbolEqualityComparer.Default.Equals(referenced, field)) continue;

                var write = ClassifyWrite(id, model);
                if (write == WriteKind.None) continue;
                anyAssignment = true;

                // ref/out passing is an opaque write — disqualifies readonly entirely.
                if (write == WriteKind.RefOrOut) return false;

                // Direct assignment must be inside an instance constructor of this type.
                if (!IsInsideOwnInstanceConstructor(id, type, model)) return false;
            }
        }

        return anyAssignment;
    }

    private enum WriteKind { None, Assignment, RefOrOut }

    /// Determine whether this reference to the field is a write, and of what kind.
    private static WriteKind ClassifyWrite(SimpleNameSyntax id, SemanticModel model)
    {
        // Unwrap `this.field` / `Type.field` member access so we inspect the outer expr.
        ExpressionSyntax expr = id;
        if (id.Parent is MemberAccessExpressionSyntax ma && ma.Name == id)
            expr = ma;

        switch (expr.Parent)
        {
            case AssignmentExpressionSyntax assign when assign.Left == expr:
                return WriteKind.Assignment;
            case PrefixUnaryExpressionSyntax pre when IsIncDec(pre.OperatorToken.Text):
                return WriteKind.Assignment;
            case PostfixUnaryExpressionSyntax post when IsIncDec(post.OperatorToken.Text):
                return WriteKind.Assignment;
            case ArgumentSyntax { RefKindKeyword.RawKind: not (int)SyntaxKind.None }:
                return WriteKind.RefOrOut;
            default:
                return WriteKind.None;
        }
    }

    private static bool IsIncDec(string op) => op is "++" or "--";

    private static bool IsInsideOwnInstanceConstructor(SyntaxNode node, INamedTypeSymbol type, SemanticModel model)
    {
        for (var n = node.Parent; n is not null; n = n.Parent)
        {
            switch (n)
            {
                // A local function / lambda body executes later, not during construction.
                case AnonymousFunctionExpressionSyntax:
                case LocalFunctionStatementSyntax:
                    return false;
                case ConstructorDeclarationSyntax ctor:
                    if (model.GetDeclaredSymbol(ctor) is not IMethodSymbol cs) return false;
                    return !cs.IsStatic &&
                           SymbolEqualityComparer.Default.Equals(cs.ContainingType, type);
                case BaseMethodDeclarationSyntax:
                case AccessorDeclarationSyntax:
                case TypeDeclarationSyntax:
                    return false;
            }
        }
        return false;
    }
}
