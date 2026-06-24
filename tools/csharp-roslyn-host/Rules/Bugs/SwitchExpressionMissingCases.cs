using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A switch EXPRESSION whose governing type is an enum that does not handle every
/// declared member and has no discard (`_`) arm. Unmatched values throw
/// SwitchExpressionException at runtime. We require the switch's type to be a
/// non-[Flags] enum (flags combinations make exhaustiveness checking meaningless),
/// collect the enum constants named in `constant`/`Enum.Member` patterns, and report
/// the gap. Needs the governing type plus the resolved enum member set. IDE0072.
/// </summary>
internal sealed class SwitchExpressionMissingCases : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/switch-expression-missing-cases";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var sw in tree.GetRoot().DescendantNodes().OfType<SwitchExpressionSyntax>())
        {
            var govType = model.GetTypeInfo(sw.GoverningExpression).Type;
            // Unwrap Nullable<TEnum> → still requires the same member coverage plus null.
            if (govType is INamedTypeSymbol { OriginalDefinition.SpecialType: SpecialType.System_Nullable_T } nn)
                govType = nn.TypeArguments[0];
            if (govType is not INamedTypeSymbol { TypeKind: TypeKind.Enum } enumType) continue;
            if (HasFlagsAttribute(enumType)) continue;

            // A discard (`_`), `var`, or unguarded type-pattern arm makes the switch
            // exhaustive by construction.
            bool hasCatchAll = sw.Arms.Any(a => a.WhenClause is null && a.Pattern switch
            {
                DiscardPatternSyntax => true,
                VarPatternSyntax => true,
                DeclarationPatternSyntax { Designation: DiscardDesignationSyntax } => true,
                _ => false,
            });
            if (hasCatchAll) continue;

            var declared = enumType.GetMembers().OfType<IFieldSymbol>()
                .Where(f => f.IsConst && f.HasConstantValue)
                .Select(f => f.Name)
                .ToHashSet(StringComparer.Ordinal);
            if (declared.Count == 0) continue;

            var handled = new HashSet<string>(StringComparer.Ordinal);
            foreach (var arm in sw.Arms)
                CollectHandled(arm.Pattern, model, enumType, handled);

            var missing = declared.Where(d => !handled.Contains(d)).OrderBy(x => x, StringComparer.Ordinal).ToList();
            if (missing.Count == 0) continue;

            var pos = sw.SwitchKeyword.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Switch expression over enum '{enumType.Name}' does not handle {string.Join(", ", missing)} and has no discard ('_') arm — unmatched values throw at runtime.");
        }
    }

    private static void CollectHandled(PatternSyntax pattern, SemanticModel model, INamedTypeSymbol enumType, HashSet<string> handled)
    {
        switch (pattern)
        {
            case ConstantPatternSyntax cp:
                if (model.GetSymbolInfo(cp.Expression).Symbol is IFieldSymbol f &&
                    SymbolEqualityComparer.Default.Equals(f.ContainingType, enumType))
                    handled.Add(f.Name);
                break;
            case BinaryPatternSyntax bp:   // `A or B`
                CollectHandled(bp.Left, model, enumType, handled);
                CollectHandled(bp.Right, model, enumType, handled);
                break;
            case ParenthesizedPatternSyntax pp:
                CollectHandled(pp.Pattern, model, enumType, handled);
                break;
        }
    }

    private static bool HasFlagsAttribute(INamedTypeSymbol type) =>
        type.GetAttributes().Any(a => a.AttributeClass is
        {
            Name: "FlagsAttribute",
            ContainingNamespace: { Name: "System", ContainingNamespace.IsGlobalNamespace: true },
        });
}
