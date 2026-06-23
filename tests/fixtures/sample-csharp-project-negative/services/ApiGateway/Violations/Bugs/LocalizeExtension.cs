using System;
using System.Windows.Markup;

namespace ApiGateway.Violations.Bugs;

/// <summary>
/// A markup extension that yields a localized string. The [ConstructorArgument] still
/// points at "key", but the constructor parameter was renamed to "resourceKey", so the
/// XAML parser can no longer map the positional argument and the extension is
/// mis-instantiated.
/// </summary>
public sealed class LocalizeExtension : MarkupExtension
{
    public LocalizeExtension(string resourceKey)
    {
        ResourceKey = resourceKey;
    }

    // VIOLATION: bugs/deterministic/constructorargument-no-matching-property
    [ConstructorArgument("key")]
    public string ResourceKey { get; set; }

    /// <inheritdoc />
    public override object ProvideValue(IServiceProvider serviceProvider) => ResourceKey;
}
