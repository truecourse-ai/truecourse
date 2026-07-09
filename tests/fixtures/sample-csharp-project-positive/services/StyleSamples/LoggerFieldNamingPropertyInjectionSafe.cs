namespace Positive.Boundary.Style;

/// <summary>Receives its logger through property injection.</summary>
internal sealed class LoggerFieldNamingPropertyInjectionSafe
{
    // SAFE: style/deterministic/logger-field-naming
    // A logger exposed as a property is PascalCase by .NET convention; the
    // camelCase/underscore convention applies to fields, not properties.
    internal ILogger Logger { get; set; }

    internal void Record(string route) => Logger.LogInformation("routed {Route}", route);
}
