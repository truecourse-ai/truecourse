using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A `[ThreadStatic]` field with an inline initializer. The initializer (run by the
/// static constructor) executes only once, on the first thread to touch the type,
/// so every OTHER thread sees the field at its default value. Needs the attribute
/// resolved to System.ThreadStaticAttribute. S2996.
/// </summary>
internal sealed class ThreadStaticInitializedInline : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/threadstatic-initialized-inline";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var fieldDecl in tree.GetRoot().DescendantNodes().OfType<FieldDeclarationSyntax>())
        {
            // Cheap pre-filter: must have an initializer somewhere.
            if (!fieldDecl.Declaration.Variables.Any(v => v.Initializer is not null)) continue;

            var isThreadStatic = fieldDecl.AttributeLists
                .SelectMany(al => al.Attributes)
                .Any(a => model.GetSymbolInfo(a).Symbol?.ContainingType is
                {
                    Name: "ThreadStaticAttribute",
                    ContainingNamespace: { Name: "System", ContainingNamespace.IsGlobalNamespace: true },
                });
            if (!isThreadStatic) continue;

            foreach (var v in fieldDecl.Declaration.Variables)
            {
                if (v.Initializer is null) continue;
                var pos = v.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"[ThreadStatic] field '{v.Identifier.Text}' has an inline initializer, which runs only on the first thread — every other thread sees the default value.");
            }
        }
    }
}
