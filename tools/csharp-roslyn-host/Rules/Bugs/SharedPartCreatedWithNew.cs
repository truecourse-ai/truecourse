using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A <c>new</c> on a type that is a shared MEF part — exported with <c>[Export]</c> and
/// <c>[PartCreationPolicy(CreationPolicy.Shared)]</c> (S4277). The container guarantees a
/// single shared instance of that part; constructing it directly produces a second,
/// uncomposed instance whose imports are never satisfied, silently breaking the
/// single-instance contract. The part's attributes are read off its own declaration, so
/// no MEF reference assemblies are needed; a part not explicitly marked Shared never fires.
/// </summary>
internal sealed class SharedPartCreatedWithNew : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/shared-part-created-with-new";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var creation in tree.GetRoot().DescendantNodes().OfType<ObjectCreationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(creation).Symbol is not IMethodSymbol ctor) continue;
            var type = ctor.ContainingType;
            if (type is null || !IsSharedMefPart(type)) continue;

            var pos = creation.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{type.Name}' is a shared MEF part; constructing it with new bypasses the composition container and yields a second, uncomposed instance. Import it instead.");
        }
    }

    private static bool IsSharedMefPart(INamedTypeSymbol type)
    {
        bool hasExport = false, hasShared = false;
        foreach (var d in type.DeclaringSyntaxReferences)
        {
            if (d.GetSyntax() is not TypeDeclarationSyntax td) continue;
            foreach (var attr in td.AttributeLists.SelectMany(l => l.Attributes))
            {
                var name = AttrSimpleName(attr);
                if (name is "Export" or "InheritedExport") hasExport = true;
                if (name == "PartCreationPolicy" && MentionsShared(attr)) hasShared = true;
            }
        }
        return hasExport && hasShared;
    }

    private static bool MentionsShared(AttributeSyntax attr) =>
        attr.ArgumentList?.Arguments.Any(a =>
            a.Expression is MemberAccessExpressionSyntax m && m.Name.Identifier.ValueText == "Shared") ?? false;

    private static string AttrSimpleName(AttributeSyntax attr)
    {
        var name = attr.Name.ToString();
        var simple = name.Contains('.') ? name[(name.LastIndexOf('.') + 1)..] : name;
        return simple.EndsWith("Attribute") ? simple[..^"Attribute".Length] : simple;
    }
}
