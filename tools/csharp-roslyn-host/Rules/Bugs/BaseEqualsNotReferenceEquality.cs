using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `base.Equals(other)` used where reference equality is intended, but the base type
/// overrides Equals with value semantics, so the call does not test identity. We bind
/// the call and walk the base hierarchy: if the resolved Equals is declared on a type
/// other than System.Object (i.e. a value-semantics override sits between here and
/// object), the call cannot be an identity check. Needs override/base resolution.
/// S3397.
/// </summary>
internal sealed class BaseEqualsNotReferenceEquality : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/base-equals-not-reference-equality";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax { Expression: BaseExpressionSyntax } ma) continue;
            if (ma.Name.Identifier.Text != "Equals") continue;
            if (inv.ArgumentList.Arguments.Count != 1) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.Name != "Equals") continue;

            // base.Equals binds to the most-derived Equals at or above the base type.
            // If that method's containing type is System.Object, it IS reference equality
            // (object.Equals on reference types). The bug shape is a value-semantics
            // override declared on a class between `object` and the call site.
            var declaring = m.ContainingType;
            if (declaring is null) continue;
            if (declaring.SpecialType == SpecialType.System_Object) continue;
            if (declaring.SpecialType == SpecialType.System_ValueType) continue;
            // ValueType.Equals is structural too, but classes are the interesting case.
            if (declaring.TypeKind != TypeKind.Class) continue;
            // The override must genuinely override object.Equals (single object parameter).
            if (m.Parameters.Length != 1 || m.Parameters[0].Type.SpecialType != SpecialType.System_Object) continue;
            if (!m.IsOverride) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"base.Equals here resolves to '{declaring.Name}.Equals', a value-semantics override — it does not test reference identity. Use object.ReferenceEquals for an identity check.");
        }
    }
}
