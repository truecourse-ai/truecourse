using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A Newtonsoft.Json JsonSerializerSettings configured with an insecure
/// TypeNameHandling (anything but None) is passed to a Newtonsoft entry point
/// (JsonConvert.DeserializeObject / SerializeObject, JsonSerializer.Create) — the
/// point where the unsafe setting actually takes effect on (de)serialization.
/// Where json-net-typenamehandling flags the misconfiguration at the property
/// assignment, this flags the call that consumes it, so a settings object built and
/// used in separate statements is still caught at the dangerous use. Bound through
/// the semantic model: the call target must be Newtonsoft, the argument must resolve
/// to a JsonSerializerSettings, and that settings object must be traced (inline
/// creation, or a local assigned from one) to an insecure TypeNameHandling with no
/// SerializationBinder. CWE-502.
/// </summary>
internal sealed class InsecureJsonSerializerSettings : ISemanticRule
{
    public string RuleKey => "security/deterministic/insecure-jsonserializersettings";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        var root = tree.GetRoot();
        foreach (var inv in root.DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol method) continue;
            if (!IsNewtonsoftEntryPoint(method)) continue;

            // Find the JsonSerializerSettings argument by bound parameter type.
            var settingsArg = FindSettingsArgument(model, inv, method);
            if (settingsArg is null) continue;

            var creation = ResolveSettingsCreation(model, settingsArg, root);
            if (creation is null) continue;
            if (!CreationIsInsecure(model, creation, out var member)) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"JsonSerializerSettings with TypeNameHandling.{member} is passed to {method.ContainingType?.Name}." +
                $"{method.Name} — deserialization can instantiate attacker-named CLR types. Use TypeNameHandling.None, or set a SerializationBinder.");
        }
    }

    private static bool IsNewtonsoftEntryPoint(IMethodSymbol method)
    {
        var owner = method.ContainingType;
        if (owner?.ContainingNamespace?.ToDisplayString() != "Newtonsoft.Json") return false;
        return (owner.Name == "JsonConvert" && method.Name is "DeserializeObject" or "SerializeObject" or "PopulateObject")
            || (owner.Name == "JsonSerializer" && method.Name is "Create" or "CreateDefault");
    }

    private static ArgumentSyntax? FindSettingsArgument(SemanticModel model, InvocationExpressionSyntax inv, IMethodSymbol method)
    {
        foreach (var arg in inv.ArgumentList.Arguments)
        {
            if (JsonNet.IsSettingsType(model.GetTypeInfo(arg.Expression).Type))
                return arg;
        }
        return null;
    }

    /// <summary>
    /// Resolve the settings argument to the object-creation that built it: either the
    /// argument is itself a `new JsonSerializerSettings { ... }`, or it is a local
    /// whose single initializer is one. Only these statically-traceable shapes are
    /// considered, to stay false-positive free.
    /// </summary>
    private static ObjectCreationExpressionSyntax? ResolveSettingsCreation(
        SemanticModel model, ArgumentSyntax arg, SyntaxNode root)
    {
        if (arg.Expression is ObjectCreationExpressionSyntax direct) return direct;

        if (model.GetSymbolInfo(arg.Expression).Symbol is not ILocalSymbol local) return null;

        // Find the local's declarator initializer within the same method/file.
        ObjectCreationExpressionSyntax? found = null;
        var assignments = 0;
        foreach (var decl in root.DescendantNodes().OfType<VariableDeclaratorSyntax>())
        {
            if (model.GetDeclaredSymbol(decl) is not ILocalSymbol s || !SymbolEqualityComparer.Default.Equals(s, local))
                continue;
            if (decl.Initializer?.Value is ObjectCreationExpressionSyntax oce) found = oce;
            assignments++;
        }
        // If the local is reassigned anywhere, the construction we found may not be
        // what's passed — bail rather than risk a false positive.
        foreach (var a in root.DescendantNodes().OfType<AssignmentExpressionSyntax>())
        {
            if (a.IsKind(SyntaxKind.SimpleAssignmentExpression)
                && model.GetSymbolInfo(a.Left).Symbol is ILocalSymbol ls
                && SymbolEqualityComparer.Default.Equals(ls, local))
                assignments++;
        }

        return assignments == 1 ? found : null;
    }

    /// <summary>
    /// True if the creation's object initializer sets TypeNameHandling to an insecure
    /// value with no SerializationBinder set alongside.
    /// </summary>
    private static bool CreationIsInsecure(SemanticModel model, ObjectCreationExpressionSyntax creation, out string member)
    {
        member = "";
        if (!JsonNet.IsSettingsType(model.GetTypeInfo(creation).Type)) return false;
        if (creation.Initializer is null) return false;

        var assignments = creation.Initializer.Expressions.OfType<AssignmentExpressionSyntax>().ToList();
        var binderSet = assignments.Any(a =>
            a.Left is IdentifierNameSyntax { Identifier.ValueText: "SerializationBinder" or "Binder" });

        foreach (var a in assignments)
        {
            if (a.Left is not IdentifierNameSyntax { Identifier.ValueText: "TypeNameHandling" }) continue;
            if (!JsonNet.IsInsecureTypeNameHandling(model, a.Right, out member)) continue;
            if (binderSet) return false; // mitigated by a binder
            return true;
        }
        return false;
    }
}
