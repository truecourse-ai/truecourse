using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A parameter carries [DefaultParameterValue] but NOT [Optional]. The default is then never
/// actually applied — the parameter remains required, so the value is dead metadata. We
/// resolve the attributes on the parameter symbol (both live in
/// System.Runtime.InteropServices) to confirm the pairing is broken.
/// </summary>
internal sealed class DefaultParameterValueWithoutOptional : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/defaultparametervalue-without-optional";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var paramSyntax in tree.GetRoot().DescendantNodes().OfType<ParameterSyntax>())
        {
            if (paramSyntax.AttributeLists.Count == 0) continue;
            if (model.GetDeclaredSymbol(paramSyntax) is not IParameterSymbol p) continue;

            var attrs = p.GetAttributes();
            bool hasDefaultValue = attrs.Any(a => a.AttributeClass?.Name == "DefaultParameterValueAttribute");
            if (!hasDefaultValue) continue;
            bool hasOptional = attrs.Any(a => a.AttributeClass?.Name == "OptionalAttribute");
            if (hasOptional) continue;
            // A `= value` C# default makes it optional anyway; only the bare attribute is the bug.
            if (p.IsOptional) continue;

            var pos = paramSyntax.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Parameter '{p.Name}' has [DefaultParameterValue] but not [Optional], so the default is never used — add [Optional] (or use a C# `= value` default).");
        }
    }
}
