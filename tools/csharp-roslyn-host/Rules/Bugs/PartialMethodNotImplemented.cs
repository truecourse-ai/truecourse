using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A classic (void, no accessibility modifier) partial method is DECLARED but never
/// implemented in any part of the type, so the compiler silently removes the declaration
/// and every call to it — easy to read as "this hook runs" when it does not. We use the
/// symbol's PartialImplementationPart to confirm no implementing body exists across all
/// partial parts. S3251.
/// </summary>
internal sealed class PartialMethodNotImplemented : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/partial-method-not-implemented";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (!method.Modifiers.Any(SyntaxKind.PartialKeyword)) continue;
            // The defining declaration has no body. (An implementing part has a body — skip it.)
            if (method.Body is not null || method.ExpressionBody is not null) continue;

            if (model.GetDeclaredSymbol(method) is not IMethodSymbol sym) continue;
            if (!sym.IsPartialDefinition) continue;

            // Extended partial methods (with accessibility / non-void return / out params)
            // REQUIRE an implementation — the compiler errors if missing, so reporting them
            // would be redundant. Only the classic implicitly-private void form is silently dropped.
            if (sym.DeclaredAccessibility != Accessibility.Private) continue;
            if (sym.ReturnType.SpecialType != SpecialType.System_Void) continue;
            if (sym.Parameters.Any(p => p.RefKind is RefKind.Out or RefKind.Ref)) continue;

            if (sym.PartialImplementationPart is not null) continue;

            var pos = method.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Partial method '{sym.Name}' is declared but never implemented — the compiler removes it and all calls to it; provide an implementing part or delete the declaration.");
        }
    }
}
