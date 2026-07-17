using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A method/property/delegate whose return type is the bare identifier
/// <c>partial</c>. Newer C# rules treat <c>partial</c> as a type modifier in more
/// positions, so a return type named partial must be escaped as <c>@partial</c> to
/// keep parsing unambiguously. We flag only an unescaped <c>partial</c> used in
/// return-type position and confirm via the semantic model that it binds to a real
/// named type (not the modifier), so legitimate partial-member declarations are
/// never touched.
///
/// Under the C# 14 grammar (partial constructors) the method form no longer even
/// parses as a return type: <c>partial M()</c> inside <c>class C</c> becomes a
/// *constructor* named M with a <c>partial</c> modifier — silently, with no parse
/// diagnostics. That shape is caught by the constructor branch: a partial
/// "constructor" whose name differs from its containing type, while a type named
/// <c>partial</c> is in scope, can only be the pre-C#14 method form. Property and
/// indexer positions still parse the old way and stay on the return-type branch.
/// </summary>
internal sealed class PartialReturnTypeEscape : ISemanticRule
{
    public string RuleKey => "style/deterministic/partial-return-type-escape";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var node in tree.GetRoot().DescendantNodes())
        {
            // C# 14 misparse shape: `partial M()` inside `class C` parses as a
            // partial constructor named M. A genuine partial constructor is named
            // after its type, so a name mismatch plus a type named `partial` in
            // scope means this was a method returning that type.
            if (node is ConstructorDeclarationSyntax ctor)
            {
                var partialToken = ctor.Modifiers.FirstOrDefault(t => t.IsKind(SyntaxKind.PartialKeyword));
                if (partialToken == default) continue;
                var typeName = (ctor.Parent as BaseTypeDeclarationSyntax)?.Identifier.ValueText;
                if (typeName is null || typeName == ctor.Identifier.ValueText) continue;
                if (!model.LookupNamespacesAndTypes(partialToken.SpanStart, name: "partial")
                        .OfType<INamedTypeSymbol>().Any()) continue;

                var ctorPos = partialToken.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, ctorPos.Line + 1, ctorPos.Character + 1,
                    "Return type named 'partial' must be escaped as '@partial' to remain valid under newer C# rules.");
                continue;
            }

            var returnType = node switch
            {
                MethodDeclarationSyntax m => m.ReturnType,
                DelegateDeclarationSyntax d => d.ReturnType,
                PropertyDeclarationSyntax p => p.Type,
                IndexerDeclarationSyntax i => i.Type,
                OperatorDeclarationSyntax o => o.ReturnType,
                ConversionOperatorDeclarationSyntax c => c.Type,
                _ => null,
            };

            if (returnType is not IdentifierNameSyntax id) continue;
            // Token.Text keeps the leading @, so an already-escaped `@partial` is "@partial" and skipped.
            if (id.Identifier.Text != "partial") continue;

            // Confirm it resolves to a named type — i.e. it is genuinely being used
            // as a return type, not parsed as a modifier on a partial member.
            if (model.GetTypeInfo(id).Type is not INamedTypeSymbol) continue;

            var pos = id.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Return type named 'partial' must be escaped as '@partial' to remain valid under newer C# rules.");
        }
    }
}
