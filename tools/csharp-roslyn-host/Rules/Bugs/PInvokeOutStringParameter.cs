using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A P/Invoke (`[DllImport]` extern) method with a by-value `string` parameter that
/// also carries `[Out]`. Marshalling writes back into the managed string's buffer,
/// which can corrupt interned strings and destabilize the runtime; a StringBuilder or
/// char[] should be used for writable string buffers. We require the method to be a
/// DllImport extern and the parameter to be a non-ref/out `string` with [Out]. Needs
/// the resolved parameter type plus its attributes. CA1417.
/// </summary>
internal sealed class PInvokeOutStringParameter : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/pinvoke-out-string-parameter";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(method) is not IMethodSymbol m) continue;
            if (!IsDllImport(m)) continue;

            foreach (var p in m.Parameters)
            {
                // Only by-value string parameters (ref/out string are legitimate).
                if (p.RefKind != RefKind.None) continue;
                if (p.Type.SpecialType != SpecialType.System_String) continue;
                if (!HasOutAttribute(p)) continue;

                var loc = p.Locations.FirstOrDefault(l => l.SourceTree == tree);
                if (loc is null) continue;
                var pos = loc.GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"[Out] on by-value string parameter '{p.Name}' of P/Invoke '{m.Name}' can corrupt interned strings. Use a StringBuilder or char[] for a writable buffer.");
            }
        }
    }

    private static bool IsDllImport(IMethodSymbol m) =>
        m.GetAttributes().Any(a => a.AttributeClass is
        {
            Name: "DllImportAttribute",
            ContainingNamespace: { Name: "InteropServices" },
        });

    private static bool HasOutAttribute(IParameterSymbol p) =>
        p.GetAttributes().Any(a => a.AttributeClass is
        {
            Name: "OutAttribute",
            ContainingNamespace: { Name: "InteropServices" },
        });
}
