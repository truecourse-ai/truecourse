using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// [DefaultValue] (System.ComponentModel) is applied to a PARAMETER as if it set the
/// parameter's default. It does not — only [DefaultParameterValue] (with [Optional]) does;
/// [DefaultValue] is a designer/serialization hint and is ignored for call-site defaulting.
/// We resolve the attribute on the parameter symbol to confirm the misuse. S3451.
/// </summary>
internal sealed class DefaultValueInsteadOfDefaultParameterValue : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/defaultvalue-instead-of-defaultparametervalue";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var paramSyntax in tree.GetRoot().DescendantNodes().OfType<ParameterSyntax>())
        {
            if (paramSyntax.AttributeLists.Count == 0) continue;
            if (model.GetDeclaredSymbol(paramSyntax) is not IParameterSymbol p) continue;

            var attrs = p.GetAttributes();
            bool hasDefaultValueAttr = attrs.Any(a =>
                a.AttributeClass is { Name: "DefaultValueAttribute" } c &&
                c.ContainingNamespace?.ToDisplayString() == "System.ComponentModel");
            if (!hasDefaultValueAttr) continue;

            // If the author ALSO uses the correct mechanism, there's no defaulting bug.
            if (attrs.Any(a => a.AttributeClass?.Name == "DefaultParameterValueAttribute")) continue;
            if (p.IsOptional) continue; // a real `= value` default is already in effect

            var pos = paramSyntax.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"[DefaultValue] on parameter '{p.Name}' does not set its default value (it is ignored for call-site defaulting) — use [Optional, DefaultParameterValue(...)] or a C# `= value` default.");
        }
    }
}
