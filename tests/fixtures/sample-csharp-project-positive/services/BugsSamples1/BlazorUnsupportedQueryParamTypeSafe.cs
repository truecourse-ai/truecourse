using Microsoft.AspNetCore.Components;

namespace Positive.Boundary.Bugs;

/// <summary>Query state for a product listing page bound from the query string.</summary>
public sealed class BlazorUnsupportedQueryParamTypeSafe
{
    /// <summary>Selected category id, bound as a supported scalar (not a generic collection).</summary>
    // SAFE: bugs/deterministic/blazor-unsupported-query-param-type
    [SupplyParameterFromQuery]
    public int CategoryId { get; init; }
}
