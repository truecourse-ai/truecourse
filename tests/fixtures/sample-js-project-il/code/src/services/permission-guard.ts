// FP-GUARD: named-constant/no-code-counterpart — must NOT drift
// Paraphrase of a permission object whose properties are named as
// "Obj.prop" in the spec (dotted path). The extractor must emit the
// dotted form CRUD_PERMS.read / CRUD_PERMS.create so the comparator
// can match the spec identity without reporting no-code-counterpart.
export const CRUD_PERMS = {
  read:   'module::catalog.items.read',
  create: 'module::catalog.items.create',
} as const;

// CRUD_PERMS.write is intentionally absent — regression: the
// no-code-counterpart drift must still fire for this property.
// IL-DRIFT: NamedConstant:CRUD_PERMS.write / constant.CRUD_PERMS.write.no-code-counterpart
