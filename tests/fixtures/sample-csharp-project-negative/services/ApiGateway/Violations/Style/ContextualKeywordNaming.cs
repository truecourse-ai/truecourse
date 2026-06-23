namespace ApiGateway.Violations.Style;

/// <summary>A model type that predates the `partial` contextual keyword usage below.</summary>
// The type name is lower-cased, against the PascalCase convention for types.
// VIOLATION: style/deterministic/csharp-naming-convention
// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal sealed class @partial { }

/// <summary>
/// Members named with C# contextual keywords, which read ambiguously against the
/// modifiers of the same spelling.
/// </summary>
internal sealed class KeywordNaming
{
    // A private stub named `extension` collides with the contextual `extension`
    // keyword, is never called, and has no body.
    // VIOLATION: style/deterministic/extension-keyword-conflict
    // VIOLATION: code-quality/deterministic/empty-function
    // VIOLATION: code-quality/deterministic/no-empty-function
    // VIOLATION: code-quality/deterministic/unused-private-method
    // VIOLATION: code-quality/deterministic/missing-access-modifier
    void extension() { }

    // The return type is the bare identifier `partial`, which reads as the modifier.
    // VIOLATION: style/deterministic/partial-return-type-escape
    partial M() { return null; }
}
