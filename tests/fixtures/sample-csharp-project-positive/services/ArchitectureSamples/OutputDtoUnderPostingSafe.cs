namespace Positive.Boundary.Architecture;

/// <summary>
/// An audit/output DTO: its non-nullable value types are set server-side and it
/// is never model-bound from a request, so it cannot under-post. The `Dto` suffix
/// is an output shape, not a bound input, so value-type-action-param-under-posting
/// must not fire.
/// </summary>
public sealed class OutputDtoUnderPostingSafe
{
    /// <summary>Server-set soft-delete flag on the response.</summary>
    // SAFE: architecture/deterministic/value-type-action-param-under-posting
    public bool IsDeleted { get; set; }

    /// <summary>Server-computed count on the response.</summary>
    // SAFE: architecture/deterministic/value-type-action-param-under-posting
    public int Count { get; set; }
}

/// <summary>A server-constructed error view model, never request-bound.</summary>
public sealed class ErrorPageViewModel
{
    /// <summary>The HTTP status the server rendered.</summary>
    // SAFE: architecture/deterministic/value-type-action-param-under-posting
    public int StatusCode { get; set; }
}
