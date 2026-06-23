using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A method that offers both a <c>string</c> overload and a <c>System.Uri</c>
/// overload, where the string overload does not delegate to the Uri one — it neither
/// constructs a <c>Uri</c> nor calls the sibling overload, so it parses the URL ad
/// hoc. That duplicates (and usually diverges from) the validated Uri path, the
/// reason the Uri overload exists. The string overload should build a <c>Uri</c> and
/// forward. Only flagged when the Uri sibling actually exists and the string body
/// references neither <c>Uri</c> nor the overload, keeping it false-positive free.
/// </summary>
internal sealed class UriStringOverloadNotDelegating : ISemanticRule
{
    public string RuleKey => "architecture/deterministic/uri-string-overload-not-delegating";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            var methods = typeDecl.Members.OfType<MethodDeclarationSyntax>().ToList();
            foreach (var group in methods.GroupBy(m => m.Identifier.Text))
            {
                var overloads = group.ToList();
                if (!overloads.Any(m => HasUriParam(m, model))) continue;

                foreach (var strM in overloads)
                {
                    if (!HasStringParam(strM, model)) continue;
                    if (HasUriParam(strM, model)) continue; // already a Uri overload
                    SyntaxNode? body = (SyntaxNode?)strM.Body ?? strM.ExpressionBody;
                    if (body is null) continue;
                    if (DelegatesToUri(body, group.Key, model)) continue;

                    var pos = strM.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                    yield return new Violation(
                        RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                        $"The string overload of '{group.Key}' does not delegate to its Uri overload — build a Uri and forward, rather than parsing the URL here.");
                }
            }
        }
    }

    private static bool HasStringParam(MethodDeclarationSyntax m, SemanticModel model) =>
        m.ParameterList.Parameters.Any(p =>
            model.GetDeclaredSymbol(p) is IParameterSymbol { Type.SpecialType: SpecialType.System_String });

    private static bool HasUriParam(MethodDeclarationSyntax m, SemanticModel model) =>
        m.ParameterList.Parameters.Any(p =>
            model.GetDeclaredSymbol(p) is IParameterSymbol { Type: { Name: "Uri" } t } &&
            t.ContainingNamespace?.ToDisplayString() == "System");

    private static bool DelegatesToUri(SyntaxNode body, string name, SemanticModel model)
    {
        foreach (var node in body.DescendantNodes())
        {
            if (node is ObjectCreationExpressionSyntax oc &&
                model.GetSymbolInfo(oc.Type).Symbol is INamedTypeSymbol { Name: "Uri", ContainingNamespace.Name: "System" })
                return true;
            if (node is InvocationExpressionSyntax inv && InvokedName(inv) == name)
                return true;
        }
        return false;
    }

    private static string InvokedName(InvocationExpressionSyntax inv) => inv.Expression switch
    {
        IdentifierNameSyntax id => id.Identifier.Text,
        MemberAccessExpressionSyntax ma => ma.Name.Identifier.Text,
        _ => string.Empty,
    };
}
