using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A type or namespace whose name matches a keyword reserved by a common CLR
/// language (C#, VB.NET). Consumers in that language must escape the name, and some
/// cannot reference it at all. Needs the declared symbol so we only flag the actual
/// publicly-visible declared name. CA1716.
/// </summary>
internal sealed class IdentifierMatchesKeyword : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/identifier-matches-keyword";

    // Cross-language reserved words (the CA1716 set): C# and VB.NET keywords that
    // collide. Compared case-insensitively because VB is case-insensitive.
    private static readonly HashSet<string> Reserved = new(StringComparer.OrdinalIgnoreCase)
    {
        "AddHandler", "AddressOf", "Alias", "And", "AndAlso", "As", "Boolean", "ByRef",
        "Byte", "ByVal", "Call", "Case", "Catch", "CBool", "CByte", "CChar", "CDate",
        "CDec", "CDbl", "Char", "CInt", "Class", "CLng", "CObj", "Const", "Continue",
        "CSByte", "CShort", "CSng", "CStr", "CType", "CUInt", "CULng", "CUShort", "Date",
        "Decimal", "Declare", "Default", "Delegate", "Dim", "DirectCast", "Do", "Double",
        "Each", "Else", "ElseIf", "End", "EndIf", "Enum", "Erase", "Error", "Event",
        "Exit", "False", "Finally", "For", "Friend", "Function", "Get", "GetType",
        "GetXmlNamespace", "Global", "GoSub", "GoTo", "Handles", "If", "Implements",
        "Imports", "In", "Inherits", "Integer", "Interface", "Is", "IsNot", "Let", "Lib",
        "Like", "Long", "Loop", "Me", "Mod", "Module", "MustInherit", "MustOverride",
        "MyBase", "MyClass", "Namespace", "Narrowing", "New", "Next", "Not", "Nothing",
        "NotInheritable", "NotOverridable", "Object", "Of", "On", "Operator", "Option",
        "Optional", "Or", "OrElse", "Overloads", "Overridable", "Overrides", "ParamArray",
        "Partial", "Private", "Property", "Protected", "Public", "RaiseEvent", "ReadOnly",
        "ReDim", "REM", "RemoveHandler", "Resume", "Return", "SByte", "Select", "Set",
        "Shadows", "Shared", "Short", "Single", "Static", "Step", "Stop", "String",
        "Structure", "Sub", "SyncLock", "Then", "Throw", "To", "True", "Try", "TryCast",
        "TypeOf", "UInteger", "ULong", "UShort", "Using", "Variant", "Wend", "When",
        "While", "Widening", "With", "WithEvents", "WriteOnly", "Xor",
    };

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<BaseTypeDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol sym) continue;
            // Only externally-visible types create a cross-language consumer hazard.
            if (sym.DeclaredAccessibility is not (Accessibility.Public or Accessibility.Protected
                or Accessibility.ProtectedOrInternal)) continue;
            if (!Reserved.Contains(sym.Name)) continue;

            var pos = typeDecl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Type name '{sym.Name}' matches a reserved keyword in another CLR language; consumers there must escape or cannot use it.");
        }

        foreach (var ns in tree.GetRoot().DescendantNodes().OfType<BaseNamespaceDeclarationSyntax>())
        {
            foreach (var part in ns.Name.ToString().Split('.'))
            {
                if (!Reserved.Contains(part)) continue;
                var pos = ns.Name.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Namespace segment '{part}' matches a reserved keyword in another CLR language.");
                break;
            }
        }
    }
}
