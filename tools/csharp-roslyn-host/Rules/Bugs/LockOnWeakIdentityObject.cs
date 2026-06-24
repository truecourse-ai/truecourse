using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `lock` taken on a "weak-identity" object whose identity is not unique within the process:
/// String, a Type (System.Type / reflection runtime types), MarshalByRefObject, ExecutionEngineException,
/// OutOfMemoryException, StackOverflowException, or any MemberInfo/ParameterInfo. Such objects
/// can be shared or marshalled, so the monitor a lock acquires is not exclusive. Identifying
/// the static type and walking its base chain needs the semantic model. CA2002.
/// </summary>
internal sealed class LockOnWeakIdentityObject : ISemanticRule
{
    private static readonly HashSet<string> WeakByFullName = new(StringComparer.Ordinal)
    {
        "System.String",
        "System.MarshalByRefObject",
        "System.Reflection.MemberInfo",
        "System.Reflection.ParameterInfo",
        "System.ExecutionEngineException",
        "System.OutOfMemoryException",
        "System.StackOverflowException",
        "System.Type",
    };

    public string RuleKey => "bugs/deterministic/lock-on-weak-identity-object";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var stmt in tree.GetRoot().DescendantNodes().OfType<LockStatementSyntax>())
        {
            var type = model.GetTypeInfo(stmt.Expression).Type;
            if (type is null || type.TypeKind == TypeKind.Error) continue;

            var matched = WeakName(type);
            if (matched is null) continue;

            var pos = stmt.Expression.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"lock on a weak-identity object (type '{matched}') — its identity is not unique within the process, so the lock can be defeated. Lock on a private, readonly object instead.");
        }
    }

    private static string? WeakName(ITypeSymbol type)
    {
        for (var t = type; t is not null; t = t.BaseType)
        {
            // Special types (string) render as the C# keyword via ToDisplayString, so match
            // those explicitly; everything else by its namespace-qualified metadata name.
            if (t.SpecialType == SpecialType.System_String) return "System.String";
            var name = QualifiedName(t);
            if (WeakByFullName.Contains(name)) return name;
        }
        // Type's runtime subclass surfaces as System.Type along the base chain; covered above.
        return null;
    }

    private static string QualifiedName(ITypeSymbol t)
    {
        var ns = t.ContainingNamespace;
        return ns is null || ns.IsGlobalNamespace ? t.Name : $"{ns.ToDisplayString()}.{t.Name}";
    }
}
