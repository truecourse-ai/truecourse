using System.Collections.Generic;
using Microsoft.AspNetCore.Components;

namespace ApiGateway.Violations.Bugs;

/// <summary>
/// Query state for a product listing page. The selected category ids are bound straight
/// from the query string as a List — a type Blazor cannot bind, since query binding takes
/// only scalars and arrays of them — so the page throws when navigated to with that
/// parameter. The free-text search, a plain string, binds fine.
/// </summary>
internal sealed class ProductListingState
{
    // VIOLATION: bugs/deterministic/blazor-unsupported-query-param-type
    // VIOLATION: code-quality/deterministic/writable-collection-property
    [SupplyParameterFromQuery]
    public List<int> CategoryIds { get; set; } = new();

    // A supported scalar — binds fine, must not fire.
    [SupplyParameterFromQuery]
    public string? Search { get; set; }
}
