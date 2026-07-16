using Demo.Building;

namespace Demo.Fluent;

/// <summary>
/// Fluent extension setters over <see cref="FluentBuilder"/>. Each returns the
/// extended `this` receiver type, so a value parameter named after the method is
/// the idiomatic builder shape and must not be flagged as duplicating the method
/// name.
/// </summary>
public static class FluentBuilderExtensions
{
    /// <summary>Marks the item pinned; returns the receiver for chaining.</summary>
    public static FluentBuilder Pinned(this FluentBuilder builder, bool pinned)
    {
        return builder.Visible(pinned);
    }
}
