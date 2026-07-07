namespace Positive.Boundary.CodeQuality;

// SAFE: code-quality/deterministic/csharp-filename-type-mismatch
// The file is named after the attribute's usage name (RetentionPolicy); by the
// standard C# 'Attribute' suffix convention the declared type is
// RetentionPolicyAttribute, so the file is correctly located — not a mismatch.
[System.AttributeUsage(System.AttributeTargets.Class | System.AttributeTargets.Method)]
internal sealed class RetentionPolicyAttribute : System.Attribute
{
}
