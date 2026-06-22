using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A custom exception type (derives from System.Exception) that is missing one of the
/// three conventional constructors: parameterless, (string message), and
/// (string message, Exception inner). Callers and frameworks (serialization,
/// re-wrapping) expect these, so the omission limits usability. We only consider
/// public/accessible exception classes and require all three. Needs base-type
/// resolution and the declared constructor set. CA1032.
/// </summary>
internal sealed class ExceptionMissingStandardConstructors : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/exception-missing-standard-constructors";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var cls in tree.GetRoot().DescendantNodes().OfType<ClassDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(cls) is not INamedTypeSymbol sym) continue;
            if (sym.IsAbstract) continue;
            if (!DerivesFromException(sym)) continue;
            // Only flag types the rest of the world can construct.
            if (sym.DeclaredAccessibility is not (Accessibility.Public or Accessibility.Internal)) continue;

            var ctors = sym.Constructors.Where(c => !c.IsStatic).ToList();

            bool hasParameterless = ctors.Any(c => c.Parameters.Length == 0);
            bool hasMessage = ctors.Any(c =>
                c.Parameters.Length == 1 && IsString(c.Parameters[0].Type));
            bool hasMessageInner = ctors.Any(c =>
                c.Parameters.Length == 2 && IsString(c.Parameters[0].Type) && IsException(c.Parameters[1].Type));

            var missing = new List<string>();
            if (!hasParameterless) missing.Add("()");
            if (!hasMessage) missing.Add("(string message)");
            if (!hasMessageInner) missing.Add("(string message, Exception innerException)");
            if (missing.Count == 0) continue;

            var pos = cls.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Exception '{sym.Name}' is missing the standard constructor(s) {string.Join(", ", missing)} — add them so callers can construct it conventionally.");
        }
    }

    private static bool DerivesFromException(INamedTypeSymbol type)
    {
        for (var t = type.BaseType; t is not null; t = t.BaseType)
            if (t is { Name: "Exception", ContainingNamespace: { Name: "System", ContainingNamespace.IsGlobalNamespace: true } })
                return true;
        return false;
    }

    private static bool IsString(ITypeSymbol t) => t.SpecialType == SpecialType.System_String;

    private static bool IsException(ITypeSymbol t)
    {
        for (var x = t; x is not null; x = x.BaseType)
            if (x is { Name: "Exception", ContainingNamespace: { Name: "System", ContainingNamespace.IsGlobalNamespace: true } })
                return true;
        return false;
    }
}
