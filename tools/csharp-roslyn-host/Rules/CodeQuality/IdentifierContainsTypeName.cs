using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A parameter or member identifier whose name IS exactly a data-type name (Int,
/// Integer, String, Boolean, Long, …). The type is already evident from the
/// declaration, so embedding it as the whole name is redundant and, for the
/// reserved-language-keyword set, can confuse cross-language consumers. We match the
/// canonical CA1720 token set as a whole-word name to stay false-positive-free
/// (e.g. we do not flag "stringBuilder"). CA1720.
/// </summary>
internal sealed class IdentifierContainsTypeName : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/identifier-contains-type-name";

    // The canonical data-type tokens CA1720 forbids as standalone identifiers,
    // compared case-insensitively.
    private static readonly HashSet<string> TypeTokens = new(StringComparer.OrdinalIgnoreCase)
    {
        "Int8", "UInt8", "Int16", "UInt16", "Int32", "UInt32", "Int64", "UInt64",
        "Integer", "Int", "UInt", "Short", "UShort", "Long", "ULong",
        "Byte", "SByte", "Char", "Float", "Single", "Double", "Decimal",
        "Boolean", "Bool", "String", "Object", "Ptr", "IntPtr", "UIntPtr",
        "Pointer", "Unsigned", "Unsigned8", "Unsigned16", "Unsigned32", "Unsigned64",
    };

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        var root = tree.GetRoot();

        foreach (var param in root.DescendantNodes().OfType<ParameterSyntax>())
        {
            var id = param.Identifier;
            if (id.IsKind(Microsoft.CodeAnalysis.CSharp.SyntaxKind.None)) continue;
            if (!TypeTokens.Contains(id.ValueText)) continue;
            // Skip the implicit setter `value`-style params (none here) and lambda params
            // whose names are caller-chosen but local — still report only declared params
            // of methods to avoid noise from local lambdas.
            if (model.GetDeclaredSymbol(param) is not IParameterSymbol p) continue;
            if (p.ContainingSymbol is not IMethodSymbol { MethodKind: Microsoft.CodeAnalysis.MethodKind.Ordinary or Microsoft.CodeAnalysis.MethodKind.Constructor }) continue;

            var pos = id.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Parameter name '{id.ValueText}' is a data-type name; the type is already declared — choose a name that conveys role.");
        }

        foreach (var prop in root.DescendantNodes().OfType<PropertyDeclarationSyntax>())
        {
            if (!TypeTokens.Contains(prop.Identifier.ValueText)) continue;
            if (model.GetDeclaredSymbol(prop) is not IPropertySymbol ps) continue;
            if (ps.IsOverride || ImplementsAnyInterface(ps)) continue;
            var pos = prop.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Property name '{prop.Identifier.ValueText}' is a data-type name; choose a name that conveys role rather than type.");
        }
    }

    private static bool ImplementsAnyInterface(IPropertySymbol prop)
    {
        var type = prop.ContainingType;
        if (type is null) return false;
        foreach (var iface in type.AllInterfaces)
            foreach (var member in iface.GetMembers().OfType<IPropertySymbol>())
                if (SymbolEqualityComparer.Default.Equals(type.FindImplementationForInterfaceMember(member), prop))
                    return true;
        return false;
    }
}
