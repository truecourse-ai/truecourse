using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A [DebuggerDisplay("...{Member}...")] string references a simple member name that does not
/// exist on the annotated type (nor any base), so the debugger shows an error instead of a
/// value. We parse `{...}` expressions from the literal, keep only the ones that are a bare
/// identifier (optionally with the `,nq` suffix or a trailing `()` call), and check the type's
/// members through the inheritance chain via the semantic model. To stay false-positive-free we
/// ignore any placeholder containing operators, indexers, or dotted paths we can't resolve cheaply.
/// </summary>
internal sealed class DebuggerDisplayInvalidMember : ISemanticRule
{
    private static readonly Regex Brace = new(@"\{([^{}]+)\}", RegexOptions.Compiled);
    private static readonly Regex SimpleMember = new(@"^([A-Za-z_][A-Za-z0-9_]*)(\(\))?(,nq)?$", RegexOptions.Compiled);

    public string RuleKey => "bugs/deterministic/debuggerdisplay-invalid-member";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol type) continue;

            foreach (var attrList in typeDecl.AttributeLists)
                foreach (var attr in attrList.Attributes)
                {
                    if (model.GetSymbolInfo(attr).Symbol?.ContainingType?.Name != "DebuggerDisplayAttribute") continue;
                    var arg = attr.ArgumentList?.Arguments.FirstOrDefault();
                    if (arg?.Expression is not LiteralExpressionSyntax { Token.Value: string display }) continue;

                    foreach (Match brace in Brace.Matches(display))
                    {
                        var inner = brace.Groups[1].Value.Trim();
                        var m = SimpleMember.Match(inner);
                        if (!m.Success) continue; // dotted/expression placeholders — out of scope, no FP
                        var name = m.Groups[1].Value;

                        if (HasMember(type, name)) continue;

                        var pos = arg.GetLocation().GetLineSpan().StartLinePosition;
                        yield return new Violation(
                            RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                            $"[DebuggerDisplay] references '{name}', which is not a member of '{type.Name}' — the debugger will show an error instead of a value.");
                    }
                }
        }
    }

    private static bool HasMember(INamedTypeSymbol type, string name)
    {
        for (ITypeSymbol? t = type; t is not null; t = t.BaseType)
            if (t.GetMembers(name).Any(s => s is IFieldSymbol or IPropertySymbol or IMethodSymbol))
                return true;
        return false;
    }
}
