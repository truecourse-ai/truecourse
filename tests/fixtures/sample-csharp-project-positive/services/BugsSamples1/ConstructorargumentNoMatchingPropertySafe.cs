using System;
using System.Windows.Markup;

namespace Positive.Boundary.Bugs;

/// <summary>
/// A markup extension whose [ConstructorArgument] name matches an actual constructor
/// parameter, so the XAML parser can map the positional argument and the rule must not
/// fire.
/// </summary>
public sealed class ConstructorargumentNoMatchingPropertySafe : MarkupExtension
{
    /// <summary>Builds the extension from a resource key.</summary>
    public ConstructorargumentNoMatchingPropertySafe(string resourceKey)
    {
        ResourceKey = resourceKey;
    }

    // SAFE: bugs/deterministic/constructorargument-no-matching-property
    [ConstructorArgument("resourceKey")]
    public string ResourceKey { get; set; }

    /// <inheritdoc />
    public override object ProvideValue(IServiceProvider serviceProvider) => ResourceKey;
}
