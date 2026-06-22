using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An externally-visible method takes a URL as a `string` parameter but the declaring
/// type offers no overload accepting a `System.Uri` for it. Strings are parsed and
/// validated ad hoc at every call site; a `Uri` overload makes the contract explicit
/// and validated once. Confirming the parameter type is `string`, that the name truly
/// denotes a URL, and that no `Uri` overload exists needs the semantic model. CA2234.
/// </summary>
internal sealed class PreferUriOverString : ISemanticRule
{
    public string RuleKey => "architecture/deterministic/prefer-uri-over-string";

    // Conservative, unambiguous URL parameter names only — avoids flagging arbitrary
    // strings. Matched case-insensitively as the whole parameter name.
    private static readonly HashSet<string> UrlNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "url", "uri", "uriString", "urlString", "requestUri", "requestUrl",
        "endpoint", "endpointUrl", "endpointUri", "baseUrl", "baseUri",
        "redirectUrl", "redirectUri", "callbackUrl", "callbackUri",
    };

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(method) is not IMethodSymbol sym) continue;
            if (sym.DeclaredAccessibility is not (Accessibility.Public or Accessibility.Protected)) continue;
            if (sym.ContainingType is not { } type) continue;
            if (type.DeclaredAccessibility is not (Accessibility.Public or Accessibility.Protected)) continue;

            foreach (var param in method.ParameterList.Parameters)
            {
                if (model.GetDeclaredSymbol(param) is not IParameterSymbol ps) continue;
                if (ps.Type.SpecialType != SpecialType.System_String) continue;
                if (!UrlNames.Contains(ps.Name)) continue;

                // Suppress when a sibling overload (same name, same arity) already takes
                // a System.Uri in this position — the Uri-typed API is offered.
                if (HasUriOverload(type, sym, ps.Ordinal)) continue;

                var loc = param.Type?.GetLocation() ?? param.GetLocation();
                var pos = loc.GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"'{type.Name}.{sym.Name}' takes URL parameter '{ps.Name}' as a string; provide or use a System.Uri overload for validated, unambiguous URLs.");
            }
        }
    }

    private static bool HasUriOverload(INamedTypeSymbol type, IMethodSymbol method, int position)
    {
        foreach (var m in type.GetMembers(method.Name).OfType<IMethodSymbol>())
        {
            if (SymbolEqualityComparer.Default.Equals(m, method)) continue;
            if (m.Parameters.Length != method.Parameters.Length) continue;
            if (position >= m.Parameters.Length) continue;
            var t = m.Parameters[position].Type;
            if (t is INamedTypeSymbol { Name: "Uri", ContainingNamespace.Name: "System" }) return true;
        }
        return false;
    }
}
