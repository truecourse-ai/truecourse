using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// Newtonsoft.Json's JsonSerializerSettings.TypeNameHandling is set to anything
/// other than None (Objects / Arrays / All / Auto). That setting lets a JSON payload
/// name the CLR type to instantiate during deserialization — a well-known
/// remote-code-execution vector. Resolved through the semantic model: we bind the
/// assigned member to confirm it is Newtonsoft.Json.JsonSerializerSettings.TypeNameHandling
/// and read the assigned value as the Newtonsoft.Json.TypeNameHandling enum, so the
/// rule never fires on an unrelated property or a same-named member of another type.
/// A custom SerializationBinder set alongside is a recognized mitigation and suppresses
/// the finding. CWE-502.
/// </summary>
internal sealed class JsonNetTypeNameHandling : ISemanticRule
{
    public string RuleKey => "security/deterministic/json-net-typenamehandling";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var assign in tree.GetRoot().DescendantNodes().OfType<AssignmentExpressionSyntax>())
        {
            if (!assign.IsKind(SyntaxKind.SimpleAssignmentExpression)) continue;

            if (model.GetSymbolInfo(assign.Left).Symbol is not IPropertySymbol prop) continue;
            if (!JsonNet.IsTypeNameHandlingProperty(prop)) continue;

            if (!JsonNet.IsInsecureTypeNameHandling(model, assign.Right, out var member)) continue;

            // A SerializationBinder configured on the same settings object restricts
            // which types can be created — the documented mitigation. Suppress.
            if (JsonNet.SiblingSetsBinder(model, assign)) continue;

            var pos = assign.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"TypeNameHandling.{member} on JsonSerializerSettings lets a JSON payload choose the CLR types to " +
                "instantiate — a known deserialization RCE vector. Use TypeNameHandling.None, or restrict types with a custom SerializationBinder.");
        }
    }
}
