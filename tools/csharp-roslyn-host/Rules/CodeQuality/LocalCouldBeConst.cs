using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A local variable initialized with a compile-time constant and never reassigned,
/// where its declared type permits `const`. Marking it `const` documents the intent
/// and lets the compiler fold it. Needs constant-folding (GetConstantValue) plus a
/// read/write scan to confirm it is never mutated. S3353 / RCS1118.
/// </summary>
internal sealed class LocalCouldBeConst : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/local-could-be-const";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var decl in tree.GetRoot().DescendantNodes().OfType<LocalDeclarationStatementSyntax>())
        {
            if (decl.IsConst) continue;
            if (decl.UsingKeyword.RawKind != (int)SyntaxKind.None) continue;
            // `var x = ...` can't be const; the type must be explicit.
            if (decl.Declaration.Type.IsVar) continue;
            // The declared type must itself be const-eligible (a primitive, string, or enum).
            var declType = model.GetTypeInfo(decl.Declaration.Type).Type;
            if (declType is null || !IsConstEligibleType(declType)) continue;

            if (decl.Parent is not BlockSyntax block) continue;

            foreach (var v in decl.Declaration.Variables)
            {
                if (v.Initializer is null) continue;
                if (model.GetDeclaredSymbol(v) is not ILocalSymbol local) continue;

                // The initializer must be a compile-time constant.
                var c = model.GetConstantValue(v.Initializer.Value);
                if (!c.HasValue) continue;
                // A null constant assigned to a reference type (string) is allowed for
                // const, but `const string s = null` is unusual — still valid; keep it.

                // Never reassigned / passed by ref anywhere in the enclosing block.
                if (IsEverWritten(block, local, model)) continue;

                var pos = v.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Local '{local.Name}' is a never-reassigned constant; mark it const.");
            }
        }
    }

    /// const is only legal for the built-in primitive types, string, and enums.
    private static bool IsConstEligibleType(ITypeSymbol type)
    {
        if (type.TypeKind == TypeKind.Enum) return true;
        return type.SpecialType is
            SpecialType.System_Boolean or SpecialType.System_Char or
            SpecialType.System_SByte or SpecialType.System_Byte or
            SpecialType.System_Int16 or SpecialType.System_UInt16 or
            SpecialType.System_Int32 or SpecialType.System_UInt32 or
            SpecialType.System_Int64 or SpecialType.System_UInt64 or
            SpecialType.System_Single or SpecialType.System_Double or
            SpecialType.System_Decimal or SpecialType.System_String;
    }

    private static bool IsEverWritten(BlockSyntax block, ILocalSymbol local, SemanticModel model)
    {
        foreach (var id in block.DescendantNodes().OfType<IdentifierNameSyntax>())
        {
            if (id.Identifier.ValueText != local.Name) continue;
            if (model.GetSymbolInfo(id).Symbol is not ILocalSymbol l) continue;
            if (!SymbolEqualityComparer.Default.Equals(l, local)) continue;

            switch (id.Parent)
            {
                case AssignmentExpressionSyntax assign when assign.Left == id:
                    return true;
                case PrefixUnaryExpressionSyntax pre when pre.OperatorToken.Text is "++" or "--":
                    return true;
                case PostfixUnaryExpressionSyntax post when post.OperatorToken.Text is "++" or "--":
                    return true;
                case ArgumentSyntax { RefKindKeyword.RawKind: not (int)SyntaxKind.None }:
                    return true;
            }
        }
        return false;
    }
}
