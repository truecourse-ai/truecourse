using System;
using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>Minimal stand-in for the Blazor component-parameter attribute.</summary>
[AttributeUsage(AttributeTargets.Property)]
public sealed class ParameterAttribute : Attribute { }

/// <summary>Minimal stand-in for the Blazor cascading-parameter attribute.</summary>
[AttributeUsage(AttributeTargets.Property)]
public sealed class CascadingParameterAttribute : Attribute { }

/// <summary>
/// A component whose collection properties carry the framework binding attributes
/// (<c>[Parameter]</c> / <c>[CascadingParameter]</c>). The framework mandates a public
/// setter so it can assign the bound value through it — the setter is contract-required,
/// not a replaceable-backing-collection hazard — so writable-collection-property must not
/// fire even though the setter is public.
/// </summary>
public sealed class WritableCollectionPropertyBlazorParameterSafe
{
    // SAFE: code-quality/deterministic/writable-collection-property
    /// <summary>Breadcrumb items supplied by the parent component via binding.</summary>
    [Parameter] public List<string> BreadcrumbItems { get; set; } = new();

    // SAFE: code-quality/deterministic/writable-collection-property
    /// <summary>Ambient tags supplied through a cascading value.</summary>
    [CascadingParameter] public List<string> AmbientTags { get; set; } = new();
}
