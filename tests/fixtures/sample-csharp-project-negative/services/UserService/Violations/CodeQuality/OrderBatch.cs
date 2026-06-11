namespace UserServiceApp.Violations.CodeQuality;

// VIOLATION: code-quality/deterministic/subclass-builtin-collection
public class OrderBatch : List<string>
{
    // The batch inherits the full mutable List surface from the base type.
}
