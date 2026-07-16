namespace Demo.Building;

/// <summary>
/// A fluent builder whose setter methods take a single value parameter named
/// after the method and return the builder for chaining. The parameter mirrors
/// the method name by idiom, not by copy-paste, so it must not be flagged as a
/// parameter duplicating its method name.
/// </summary>
public sealed class FluentBuilder
{
    /// <summary>Whether the built item is visible.</summary>
    public bool VisibleFlag { get; private set; }

    /// <summary>The built item's weight.</summary>
    public int WeightValue { get; private set; }

    /// <summary>Sets visibility; returns the builder for chaining.</summary>
    public FluentBuilder Visible(bool visible)
    {
        VisibleFlag = visible;
        return this;
    }

    /// <summary>Sets the weight; returns the builder for chaining.</summary>
    public FluentBuilder Weight(int weight)
    {
        WeightValue = weight;
        return this;
    }
}
