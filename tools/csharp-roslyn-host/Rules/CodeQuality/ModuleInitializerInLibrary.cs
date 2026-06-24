using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A <c>[ModuleInitializer]</c> method declared in a library (CA2255). Module
/// initializers run before any other code in their assembly, at a point the consuming
/// application cannot see or control — fine for an application entry assembly, but in
/// a library it imposes hidden, ordering-sensitive startup on every consumer. This is
/// project-aware: whether the assembly is a library is decided by the project's
/// <see cref="OutputKind"/>, which only exists once the real .csproj is loaded. The
/// attribute is matched by resolved symbol, not name, so a user type coincidentally
/// named <c>ModuleInitializerAttribute</c> never trips it.
/// </summary>
internal sealed class ModuleInitializerInLibrary : IProjectAwareRule
{
    public string RuleKey => "code-quality/deterministic/moduleinitializer-in-library";

    private const string AttributeName = "System.Runtime.CompilerServices.ModuleInitializerAttribute";

    public IEnumerable<Violation> Analyze(ProjectContext ctx, SemanticModel model, SyntaxTree tree)
    {
        if (ctx.OutputKind != OutputKind.DynamicallyLinkedLibrary && ctx.OutputKind != OutputKind.NetModule)
            yield break;

        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            var attr = method.AttributeLists
                .SelectMany(l => l.Attributes)
                .FirstOrDefault(a => model.GetSymbolInfo(a).Symbol?.ContainingType?.ToDisplayString() == AttributeName);
            if (attr is null) continue;

            var pos = attr.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{method.Identifier.ValueText}' is a [ModuleInitializer] in a library, forcing hidden startup on every consumer; restrict module initializers to the application entry assembly.");
        }
    }
}
