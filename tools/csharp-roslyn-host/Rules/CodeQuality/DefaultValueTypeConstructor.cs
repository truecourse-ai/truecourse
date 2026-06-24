using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `new T()` on a value type that has no user-defined parameterless constructor, so
/// it produces the zero value — `default(T)` says exactly that without implying a
/// constructor runs. Needs the resolved type to confirm it is a struct whose
/// invoked ctor is the implicit/default one. SA1129.
/// </summary>
internal sealed class DefaultValueTypeConstructor : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/default-value-type-constructor";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var ctor in tree.GetRoot().DescendantNodes().OfType<ObjectCreationExpressionSyntax>())
        {
            // Only the zero-argument, no-initializer form is equivalent to default(T).
            if (ctor.ArgumentList is { Arguments.Count: > 0 }) continue;
            if (ctor.Initializer is not null) continue;

            var type = model.GetTypeInfo(ctor).Type;
            if (type is not { IsValueType: true }) continue;
            // Enums/primitives are typically written as literals; the rule targets struct
            // value types where `new` implies a constructor that does not exist meaningfully.
            if (type.TypeKind != TypeKind.Struct) continue;
            // Tuples and nullable value types read fine as `new`; keep scope to named structs.
            if (type.IsTupleType) continue;
            if (type.OriginalDefinition.SpecialType == SpecialType.System_Nullable_T) continue;

            // If the struct declares its OWN parameterless constructor (C# 10+), `new T()`
            // runs real code and is NOT equivalent to default — suppress.
            var resolved = model.GetSymbolInfo(ctor).Symbol as IMethodSymbol;
            if (resolved is { Parameters.Length: 0, IsImplicitlyDeclared: false }) continue;

            var pos = ctor.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'new {type.Name}()' produces the zero value; use 'default' to make the intent explicit and avoid implying a constructor runs.");
        }
    }
}
