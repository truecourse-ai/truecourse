using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A switch STATEMENT whose governing type is a non-[Flags] enum does not handle every
/// declared member and has no `default:` label, leaving some enum values silently
/// unhandled. We resolve the governing type, gather the enum members named in `case`
/// labels (constant and `case Enum.Member:` patterns), and report the gap — but only when
/// there is no default label. This is the statement-form sibling of
/// switch-expression-missing-cases. IDE0010.
/// </summary>
internal sealed class SwitchMissingCases : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/switch-missing-cases";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var sw in tree.GetRoot().DescendantNodes().OfType<SwitchStatementSyntax>())
        {
            var govType = model.GetTypeInfo(sw.Expression).Type;
            if (govType is INamedTypeSymbol { OriginalDefinition.SpecialType: SpecialType.System_Nullable_T } nn)
                govType = nn.TypeArguments[0];
            if (govType is not INamedTypeSymbol { TypeKind: TypeKind.Enum } enumType) continue;
            if (HasFlagsAttribute(enumType)) continue;

            // A default label makes the switch total — nothing is unhandled.
            bool hasDefault = sw.Sections.Any(s =>
                s.Labels.Any(l => l is DefaultSwitchLabelSyntax) ||
                s.Labels.Any(l => l is CasePatternSwitchLabelSyntax { WhenClause: null, Pattern: DiscardPatternSyntax }));
            if (hasDefault) continue;

            var declared = enumType.GetMembers().OfType<IFieldSymbol>()
                .Where(f => f.IsConst && f.HasConstantValue)
                .Select(f => f.Name)
                .ToHashSet(StringComparer.Ordinal);
            if (declared.Count == 0) continue;

            var handled = new HashSet<string>(StringComparer.Ordinal);
            foreach (var section in sw.Sections)
                foreach (var label in section.Labels)
                    CollectHandled(label, model, enumType, handled);

            var missing = declared.Where(d => !handled.Contains(d)).OrderBy(x => x, StringComparer.Ordinal).ToList();
            if (missing.Count == 0) continue;

            var pos = sw.SwitchKeyword.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Switch over enum '{enumType.Name}' does not handle {string.Join(", ", missing)} and has no 'default:' — those values fall through unhandled.");
        }
    }

    private static void CollectHandled(SwitchLabelSyntax label, SemanticModel model, INamedTypeSymbol enumType, HashSet<string> handled)
    {
        switch (label)
        {
            case CaseSwitchLabelSyntax cs:
                AddIfEnumMember(cs.Value, model, enumType, handled);
                break;
            case CasePatternSwitchLabelSyntax cp:
                CollectPattern(cp.Pattern, model, enumType, handled);
                break;
        }
    }

    private static void CollectPattern(PatternSyntax pattern, SemanticModel model, INamedTypeSymbol enumType, HashSet<string> handled)
    {
        switch (pattern)
        {
            case ConstantPatternSyntax c:
                AddIfEnumMember(c.Expression, model, enumType, handled);
                break;
            case BinaryPatternSyntax bp:
                CollectPattern(bp.Left, model, enumType, handled);
                CollectPattern(bp.Right, model, enumType, handled);
                break;
            case ParenthesizedPatternSyntax pp:
                CollectPattern(pp.Pattern, model, enumType, handled);
                break;
        }
    }

    private static void AddIfEnumMember(ExpressionSyntax expr, SemanticModel model, INamedTypeSymbol enumType, HashSet<string> handled)
    {
        if (model.GetSymbolInfo(expr).Symbol is IFieldSymbol f &&
            SymbolEqualityComparer.Default.Equals(f.ContainingType, enumType))
            handled.Add(f.Name);
    }

    private static bool HasFlagsAttribute(INamedTypeSymbol type) =>
        type.GetAttributes().Any(a => a.AttributeClass is
        {
            Name: "FlagsAttribute",
            ContainingNamespace: { Name: "System", ContainingNamespace.IsGlobalNamespace: true },
        });
}
