using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// Shared semantic helpers for the Newtonsoft.Json TypeNameHandling rules. The
/// security question — is this the Newtonsoft TypeNameHandling property/enum, and is
/// the value something other than None — is answered once here against the bound
/// symbols so the rules stay precise and false-positive free.
/// </summary>
internal static class JsonNet
{
    private const string Ns = "Newtonsoft.Json";

    /// True for Newtonsoft.Json.JsonSerializerSettings.TypeNameHandling specifically.
    public static bool IsTypeNameHandlingProperty(IPropertySymbol prop)
    {
        if (prop.Name != "TypeNameHandling") return false;
        var owner = prop.ContainingType;
        return owner?.Name == "JsonSerializerSettings"
            && owner.ContainingNamespace?.ToDisplayString() == Ns;
    }

    /// True for the Newtonsoft.Json.TypeNameHandling enum type itself.
    public static bool IsTypeNameHandlingEnum(ITypeSymbol? type) =>
        type is { Name: "TypeNameHandling" }
        && type.ContainingNamespace?.ToDisplayString() == Ns;

    /// True for Newtonsoft.Json.JsonSerializerSettings.
    public static bool IsSettingsType(ITypeSymbol? type) =>
        type is { Name: "JsonSerializerSettings" }
        && type.ContainingNamespace?.ToDisplayString() == Ns;

    /// <summary>
    /// Resolve <paramref name="value"/> as a Newtonsoft TypeNameHandling enum value
    /// and report whether it is anything other than None. <paramref name="member"/> is
    /// the enum member name for the message (e.g. "Objects"). Only fires when the value
    /// binds to the Newtonsoft enum, so a stray `TypeNameHandling = 0` on some other
    /// type, or a non-enum expression, never matches.
    /// </summary>
    public static bool IsInsecureTypeNameHandling(SemanticModel model, ExpressionSyntax value, out string member)
    {
        member = "";
        var type = model.GetTypeInfo(value).Type;
        if (!IsTypeNameHandlingEnum(type)) return false;

        // None has the constant value 0; anything else is insecure. Read the constant
        // so we catch both `TypeNameHandling.Objects` and an aliased const that folds to it.
        var constant = model.GetConstantValue(value);
        if (constant is { HasValue: true, Value: not null }
            && constant.Value is int i && i == 0)
            return false;

        member = MemberName(model, value);
        return true;
    }

    private static string MemberName(SemanticModel model, ExpressionSyntax value)
    {
        if (model.GetSymbolInfo(value).Symbol is IFieldSymbol { ContainingType.TypeKind: TypeKind.Enum } f)
            return f.Name;
        if (value is MemberAccessExpressionSyntax ma) return ma.Name.Identifier.ValueText;
        return value.ToString();
    }

    /// <summary>
    /// True if the same object-initializer / assignment target also sets a
    /// SerializationBinder, the documented way to restrict the creatable types.
    /// Walks out through the enclosing initializer or the chain of assignments on
    /// the same settings instance.
    /// </summary>
    public static bool SiblingSetsBinder(SemanticModel model, AssignmentExpressionSyntax assign)
    {
        // Case 1: inside an object/collection initializer — scan its sibling assignments.
        for (SyntaxNode? n = assign.Parent; n is not null; n = n.Parent)
        {
            if (n is InitializerExpressionSyntax init)
                return init.Expressions.OfType<AssignmentExpressionSyntax>().Any(SetsBinder);
            if (n is not AssignmentExpressionSyntax && n is not InitializerExpressionSyntax) break;
        }
        return false;
    }

    private static bool SetsBinder(AssignmentExpressionSyntax a) =>
        a.Left is IdentifierNameSyntax { Identifier.ValueText: "SerializationBinder" or "Binder" }
        || (a.Left is MemberAccessExpressionSyntax m
            && m.Name.Identifier.ValueText is "SerializationBinder" or "Binder");
}
