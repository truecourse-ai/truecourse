namespace UserService.Violations.Bugs;

/// <summary>
/// Lists itself as its own base type at the same generic arity — a nonsensical,
/// self-referential inheritance chain (a copy-paste mistake). The same-name,
/// same-arity base is the genuine recursion the rule targets.
/// </summary>
// VIOLATION: bugs/deterministic/recursive-type-inheritance
internal class SelfInheritingType : SelfInheritingType
{
}
