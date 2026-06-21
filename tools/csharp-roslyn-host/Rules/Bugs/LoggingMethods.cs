using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// Shared helpers for the Microsoft.Extensions.Logging message-template rules.
/// All template rules share the same binding question: is this call really an
/// ILogger / LoggerExtensions logging method, and which argument is the template?
/// Keeping it in one place keeps the rules consistent and false-positive free.
/// </summary>
internal static class LoggingMethods
{
    private static readonly HashSet<string> LogMethodNames = new(StringComparer.Ordinal)
    {
        "Log", "LogTrace", "LogDebug", "LogInformation",
        "LogWarning", "LogError", "LogCritical",
        "BeginScope",
    };

    public static bool IsLogMethodName(string name) => LogMethodNames.Contains(name);

    /// True for ILogger / ILogger&lt;T&gt; and the static LoggerExtensions class that
    /// hosts the LogXxx extension methods — both in Microsoft.Extensions.Logging.
    public static bool IsLoggerType(INamedTypeSymbol? type)
    {
        if (type is null) return false;
        if (type.ContainingNamespace?.ToDisplayString() != "Microsoft.Extensions.Logging") return false;
        return type.Name is "ILogger" or "LoggerExtensions";
    }

    /// <summary>
    /// The message-template argument expression. The template parameter is named
    /// "message" on LoggerExtensions.LogXxx; we resolve it by the bound parameter
    /// name (skipping eventId / exception / args) rather than by position, since an
    /// optional EventId or Exception may precede it.
    /// </summary>
    public static ExpressionSyntax? FindTemplateArgument(InvocationExpressionSyntax inv, IMethodSymbol method)
    {
        var args = inv.ArgumentList.Arguments;
        var parameters = method.Parameters;

        // Map each positional/named argument to its parameter, then pick "message".
        for (var i = 0; i < args.Count; i++)
        {
            var arg = args[i];
            IParameterSymbol? param = null;

            if (arg.NameColon?.Name.Identifier.ValueText is { } named)
            {
                param = parameters.FirstOrDefault(p => p.Name == named);
            }
            else if (i < parameters.Length)
            {
                var p = parameters[i];
                // A params array (the trailing object[] args) absorbs the rest; stop.
                param = p.IsParams ? null : p;
            }

            if (param is { Name: "message" } && param.Type.SpecialType == SpecialType.System_String)
                return arg.Expression;
        }

        return null;
    }
}
