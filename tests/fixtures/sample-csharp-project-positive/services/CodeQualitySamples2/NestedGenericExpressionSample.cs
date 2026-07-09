using System;
using System.Linq.Expressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Accepts a LINQ predicate expression. The nested generic
/// <c>Expression&lt;Func&lt;string, bool&gt;&gt;</c> is the canonical expression-tree
/// idiom, not an author-controllable shape that a named type could replace, so
/// the nested-generic rule must not fire on it.
/// </summary>
public sealed class NestedGenericExpressionSample
{
    /// <summary>Returns whether a predicate expression was supplied.</summary>
    // SAFE: code-quality/deterministic/nested-generic-parameter
    public bool Matches(Expression<Func<string, bool>> predicate)
    {
        return predicate != null;
    }
}
