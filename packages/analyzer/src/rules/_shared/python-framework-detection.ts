/**
 * Framework / library detection helpers for Python visitors.
 *
 * Several Python rules need to know which web framework, ORM, validation
 * library, or data-analysis library a file uses so they can apply the right
 * detection heuristic. Without this, rules either:
 *   - hardcode one library (e.g. Django only) and produce mass FPs on
 *     unrelated codebases that happen to use similar method names, OR
 *   - use file-level keyword grep (e.g. `text.includes('boto3')`) which is
 *     fragile and exempts unrelated calls.
 *
 * The functions here detect the framework via the file's `import_statement`
 * and `import_from_statement` sources — the most reliable signal — and cache
 * the result per AST root via WeakMap.
 *
 * Mirrors `_shared/framework-detection.ts` (the JS equivalent) — see that
 * file for the JS shape.
 */
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import { getPythonModuleNode } from './python-helpers.js'

export type PythonOrm =
  | 'sqlalchemy'
  | 'django'
  | 'tortoise'
  | 'peewee'
  | 'pony'
  | 'unknown'

export type PythonWebFramework =
  | 'fastapi'
  | 'flask'
  | 'django'
  | 'starlette'
  | 'bottle'
  | 'aiohttp'
  | 'tornado'
  | 'sanic'
  | 'unknown'

export type PythonDataLib =
  | 'pandas'
  | 'polars'
  | 'numpy'
  | 'unknown'

// ---------------------------------------------------------------------------
// Import source extraction (cached per program root)
// ---------------------------------------------------------------------------

// Keyed on `Tree` rather than the root `SyntaxNode`: in web-tree-sitter, Node
// wrappers are NOT reference-stable (walking up via `.parent` returns fresh
// wrappers each call), so a WeakMap keyed on the walked-up module root misses
// the cache across different descendant entry points. `Tree` IS stable — it's
// the object returned from `parser.parse()`.
const importSourceCache = new WeakMap<Tree, Set<string>>()

/**
 * Extract all import sources (the module names) from a Python file's AST.
 * Cached per program root via WeakMap so repeated calls in the same file
 * are O(1). Mirrors the JS `getImportSources` pattern.
 *
 * Handles all Python import forms:
 *   - `import x`               → 'x'
 *   - `import x.y`             → 'x.y'
 *   - `import x as y`          → 'x'
 *   - `import a, b, c`         → 'a', 'b', 'c'
 *   - `from x import y`        → 'x'
 *   - `from x.y import z`      → 'x.y'
 *   - `from . import x`        → '.'   (relative import marker)
 *   - `from .module import x`  → '.module'
 *   - `from ..pkg import z`    → '..pkg'
 *
 * Note: this returns the *source* module of each import, NOT the imported
 * symbols. For `from os.path import join`, the source is `os.path`.
 */
export function getPythonImportSources(node: SyntaxNode): Set<string> {
  const program = getPythonModuleNode(node)
  const tree = program.tree
  const cached = importSourceCache.get(tree)
  if (cached) return cached

  const sources = new Set<string>()

  function extractFromAliasedOrDottedName(child: SyntaxNode): string | null {
    // `import x as y` → child is aliased_import; its `name` field is dotted_name
    if (child.type === 'aliased_import') {
      const name = child.childForFieldName('name')
      if (name?.type === 'dotted_name') return name.text
      return null
    }
    if (child.type === 'dotted_name') return child.text
    return null
  }

  function walk(n: SyntaxNode): void {
    // `import x`, `import x.y`, `import x as y`, `import a, b, c`
    if (n.type === 'import_statement') {
      // Iterate over `name` field children — each is a dotted_name or aliased_import.
      for (const child of n.namedChildren) {
        const src = extractFromAliasedOrDottedName(child)
        if (src) sources.add(src)
      }
      return
    }

    // `from x import y`, `from x.y import a, b`, `from . import x`
    if (n.type === 'import_from_statement') {
      const moduleName = n.childForFieldName('module_name')
      if (moduleName) {
        if (moduleName.type === 'dotted_name') {
          sources.add(moduleName.text)
        } else if (moduleName.type === 'relative_import') {
          // For relative imports, store the literal text including dots
          // (e.g. ".", ".module", "..pkg"). Visitors that don't care about
          // relative imports can simply skip entries starting with ".".
          sources.add(moduleName.text)
        }
      }
      return
    }

    for (const child of n.namedChildren) walk(child)
  }
  walk(program)

  importSourceCache.set(tree, sources)
  return sources
}

// ---------------------------------------------------------------------------
// ORM detection
// ---------------------------------------------------------------------------

/**
 * Detect the ORM used by a file. Returns 'unknown' if no recognized ORM is
 * imported. Visitors that detect ORM-specific patterns should treat 'unknown'
 * as "skip — this file doesn't use a supported ORM".
 */
export function detectPythonOrm(node: SyntaxNode): PythonOrm {
  const sources = getPythonImportSources(node)
  for (const src of sources) {
    if (src === 'sqlalchemy' || src.startsWith('sqlalchemy.')) return 'sqlalchemy'
    if (src === 'sqlmodel' || src.startsWith('sqlmodel.')) return 'sqlalchemy' // sqlmodel wraps SQLAlchemy
    if (src === 'django.db' || src.startsWith('django.db.')) return 'django'
    if (src === 'django.contrib.auth.models') return 'django'
    if (src === 'tortoise' || src.startsWith('tortoise.')) return 'tortoise'
    if (src === 'peewee' || src.startsWith('peewee.')) return 'peewee'
    if (src === 'pony.orm' || src.startsWith('pony.orm.')) return 'pony'
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Web framework detection
// ---------------------------------------------------------------------------

/**
 * Detect the web framework used by a file based on its imports.
 *
 * FastAPI is checked before Starlette because FastAPI is built on Starlette
 * and many FastAPI projects also import from `starlette` directly. The first
 * match wins.
 */
export function detectPythonWebFramework(node: SyntaxNode): PythonWebFramework {
  const sources = getPythonImportSources(node)
  // First pass: prefer FastAPI / Flask / Django over their underlying frameworks.
  for (const src of sources) {
    if (src === 'fastapi' || src.startsWith('fastapi.')) return 'fastapi'
    if (src === 'flask' || src.startsWith('flask.')) return 'flask'
    if (src === 'flask_restful' || src === 'flask_restplus') return 'flask'
    if (src === 'django' || src.startsWith('django.')) return 'django'
  }
  // Second pass: lower-level / less common frameworks.
  for (const src of sources) {
    if (src === 'starlette' || src.startsWith('starlette.')) return 'starlette'
    if (src === 'aiohttp' || src.startsWith('aiohttp.')) return 'aiohttp'
    if (src === 'tornado' || src.startsWith('tornado.')) return 'tornado'
    if (src === 'sanic' || src.startsWith('sanic.')) return 'sanic'
    if (src === 'bottle') return 'bottle'
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Data library detection
// ---------------------------------------------------------------------------

/**
 * Detect the data-analysis library used by a file based on its imports.
 */
export function detectPythonDataLib(node: SyntaxNode): PythonDataLib {
  const sources = getPythonImportSources(node)
  for (const src of sources) {
    if (src === 'pandas' || src.startsWith('pandas.')) return 'pandas'
    if (src === 'polars' || src.startsWith('polars.')) return 'polars'
    if (src === 'numpy' || src.startsWith('numpy.')) return 'numpy'
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Per-library import predicates
// ---------------------------------------------------------------------------

/** True if the file imports the AWS SDK (boto3 or aiobotocore). */
export function importsAwsSdk(node: SyntaxNode): boolean {
  const sources = getPythonImportSources(node)
  for (const src of sources) {
    if (src === 'boto3' || src.startsWith('boto3.')) return true
    if (src === 'aiobotocore' || src.startsWith('aiobotocore.')) return true
    if (src === 'botocore' || src.startsWith('botocore.')) return true
  }
  return false
}

/** True if the file imports Pydantic (any version). */
export function importsPydantic(node: SyntaxNode): boolean {
  const sources = getPythonImportSources(node)
  for (const src of sources) {
    if (src === 'pydantic' || src.startsWith('pydantic.')) return true
    if (src === 'pydantic_settings' || src.startsWith('pydantic_settings.')) return true
  }
  return false
}

/** True if the file imports FastAPI. */
export function importsFastApi(node: SyntaxNode): boolean {
  const sources = getPythonImportSources(node)
  for (const src of sources) {
    if (src === 'fastapi' || src.startsWith('fastapi.')) return true
  }
  return false
}

/** True if the file imports pandas. */
export function importsPandas(node: SyntaxNode): boolean {
  const sources = getPythonImportSources(node)
  for (const src of sources) {
    if (src === 'pandas' || src.startsWith('pandas.')) return true
  }
  return false
}

/** True if the file imports numpy. */
export function importsNumpy(node: SyntaxNode): boolean {
  const sources = getPythonImportSources(node)
  for (const src of sources) {
    if (src === 'numpy' || src.startsWith('numpy.')) return true
  }
  return false
}

/** True if the file imports Django. */
export function importsDjango(node: SyntaxNode): boolean {
  const sources = getPythonImportSources(node)
  for (const src of sources) {
    if (src === 'django' || src.startsWith('django.')) return true
  }
  return false
}

/** True if the file imports SQLAlchemy (or SQLModel which wraps it). */
export function importsSqlAlchemy(node: SyntaxNode): boolean {
  const sources = getPythonImportSources(node)
  for (const src of sources) {
    if (src === 'sqlalchemy' || src.startsWith('sqlalchemy.')) return true
    if (src === 'sqlmodel' || src.startsWith('sqlmodel.')) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Pattern recognition helpers
// ---------------------------------------------------------------------------

/** Names of FastAPI dependency-injection helpers. */
const FASTAPI_DI_HELPERS = new Set([
  'Depends',
  'Query',
  'Body',
  'Path',
  'Header',
  'Cookie',
  'Form',
  'File',
  'Security',
])

/**
 * True if `callNode` is a call to a FastAPI dependency-injection helper:
 *   Depends(...), Query(...), Body(...), Path(...), Header(...),
 *   Cookie(...), Form(...), File(...), Security(...)
 *
 * Also matches qualified forms: `fastapi.Depends(...)`, `fastapi.params.Body(...)`.
 *
 * Used by `function-call-in-default-argument` to skip the FastAPI Depends() FPs.
 */
export function isFastApiDependsCall(callNode: SyntaxNode): boolean {
  if (callNode.type !== 'call') return false
  const fn = callNode.childForFieldName('function')
  if (!fn) return false
  if (fn.type === 'identifier') {
    return FASTAPI_DI_HELPERS.has(fn.text)
  }
  if (fn.type === 'attribute') {
    const attr = fn.childForFieldName('attribute')
    return attr ? FASTAPI_DI_HELPERS.has(attr.text) : false
  }
  return false
}

/** Names of Pydantic field/validator declaration helpers. */
const PYDANTIC_FIELD_HELPERS = new Set([
  'Field',
  'PrivateAttr',
  'computed_field',
  'validator',
  'field_validator',
  'model_validator',
  'model_serializer',
  'root_validator',
  'AliasPath',
  'AliasChoices',
])

/**
 * True if `callNode` is a call to a Pydantic field declaration helper.
 * Also matches `pydantic.Field(...)` and similar qualified forms.
 *
 * Used by `builtin-shadowing` to skip Pydantic field FPs where users name
 * fields after Python builtins (`id`, `type`, `format`, etc.) — that's
 * idiomatic and harmless inside a Pydantic model.
 */
export function isPydanticFieldCall(callNode: SyntaxNode): boolean {
  if (callNode.type !== 'call') return false
  const fn = callNode.childForFieldName('function')
  if (!fn) return false
  if (fn.type === 'identifier') {
    return PYDANTIC_FIELD_HELPERS.has(fn.text)
  }
  if (fn.type === 'attribute') {
    const attr = fn.childForFieldName('attribute')
    return attr ? PYDANTIC_FIELD_HELPERS.has(attr.text) : false
  }
  return false
}

/** Names of SQLAlchemy column/relationship declaration helpers. */
const SQLALCHEMY_COLUMN_HELPERS = new Set([
  'Column',
  'mapped_column',
  'relationship',
  'deferred',
  'composite',
  'query_expression',
  'column_property',
  'synonym',
  'association_proxy',
  'hybrid_property',
])

/**
 * True if `callNode` is a call to a SQLAlchemy column/relationship helper.
 * Matches `mapped_column(...)`, `Column(...)`, `relationship(...)`,
 * `orm.mapped_column(...)`, etc.
 *
 * Used by `builtin-shadowing` to skip SQLAlchemy ORM field FPs where users
 * name columns after Python builtins (`id`, `type`, `format`, `hash`, etc.)
 * — this is the idiomatic SQLAlchemy pattern, not a real shadowing issue.
 */
export function isSqlAlchemyColumnCall(callNode: SyntaxNode): boolean {
  if (callNode.type !== 'call') return false
  const fn = callNode.childForFieldName('function')
  if (!fn) return false
  if (fn.type === 'identifier') {
    return SQLALCHEMY_COLUMN_HELPERS.has(fn.text)
  }
  if (fn.type === 'attribute') {
    const attr = fn.childForFieldName('attribute')
    return attr ? SQLALCHEMY_COLUMN_HELPERS.has(attr.text) : false
  }
  return false
}

/**
 * True if `typeNode` is a SQLAlchemy `Mapped[...]` type annotation.
 * Matches `Mapped[int]`, `Mapped[Optional[str]]`, `orm.Mapped[...]`, etc.
 *
 * Used by `builtin-shadowing` to skip SQLAlchemy 2.0-style ORM fields
 * declared as `id: Mapped[int] = mapped_column(...)`.
 *
 * Note: tree-sitter Python uses `generic_type` for bare-identifier generics
 * (`Mapped[int]`) but `subscript` for attribute-based ones (`orm.Mapped[int]`).
 * Both shapes must be handled.
 */
export function isSqlAlchemyMappedAnnotation(typeNode: SyntaxNode): boolean {
  // The `type` node wraps the actual annotation expression.
  let inner: SyntaxNode | null = typeNode
  if (inner.type === 'type') {
    inner = inner.namedChildren[0] ?? null
  }
  if (!inner) return false

  // `Mapped[int]` appears as a `generic_type` containing an identifier `Mapped`.
  if (inner.type === 'generic_type') {
    const base = inner.namedChildren[0]
    if (base?.type === 'identifier' && base.text === 'Mapped') return true
  }

  // `orm.Mapped[int]` appears as a `subscript` whose `value` is an attribute.
  if (inner.type === 'subscript') {
    const value = inner.childForFieldName('value')
    if (value?.type === 'identifier' && value.text === 'Mapped') return true
    if (value?.type === 'attribute') {
      const attr = value.childForFieldName('attribute')
      if (attr?.text === 'Mapped') return true
    }
  }

  // Bare `Mapped` without subscript (rare but valid)
  if (inner.type === 'identifier' && inner.text === 'Mapped') return true
  return false
}

/** Names of Pydantic base classes. */
const PYDANTIC_BASE_CLASSES = new Set([
  'BaseModel',
  'GenericModel',
  'BaseSettings',
  'RootModel',
  'PydanticBaseModel',
])

/**
 * True if `classNode` is a Pydantic model class — i.e., it has any direct
 * superclass named `BaseModel`, `GenericModel`, `BaseSettings`, or `RootModel`.
 *
 * Handles:
 *   - `class User(BaseModel): ...`
 *   - `class User(pydantic.BaseModel): ...`
 *   - `class User(BaseModel[T]): ...`            (Generic alias)
 *   - `class User(BaseModel, MyMixin): ...`      (multiple inheritance)
 *
 * Multi-level inheritance (e.g., `class User(MyOwnPydanticBase)` where
 * `MyOwnPydanticBase` extends `BaseModel`) is intentionally out of scope —
 * a single AST cannot resolve cross-file inheritance chains. Visitors that
 * need that should fall back to the import-level `importsPydantic` check.
 *
 * Used by `django-model-without-str` to gate the rule away from Pydantic.
 */
export function isPydanticModelClass(classNode: SyntaxNode): boolean {
  if (classNode.type !== 'class_definition') return false
  const supers = classNode.childForFieldName('superclasses')
  if (!supers) return false
  for (const child of supers.namedChildren) {
    const baseName = extractClassBaseName(child)
    if (baseName && PYDANTIC_BASE_CLASSES.has(baseName)) return true
  }
  return false
}

/** Names of Django model base classes. */
const DJANGO_MODEL_BASE_CLASSES = new Set([
  'Model',
  'AbstractUser',
  'AbstractBaseUser',
  'PermissionsMixin',
  'AbstractModel',
])

/**
 * True if `classNode` is a Django ORM model — has a Django Model superclass.
 * Handles `class User(models.Model)`, `class User(Model)`, `class User(AbstractUser)`, etc.
 */
export function isDjangoModelClass(classNode: SyntaxNode): boolean {
  if (classNode.type !== 'class_definition') return false
  const supers = classNode.childForFieldName('superclasses')
  if (!supers) return false
  for (const child of supers.namedChildren) {
    const baseName = extractClassBaseName(child)
    if (baseName && DJANGO_MODEL_BASE_CLASSES.has(baseName)) return true
  }
  return false
}

/**
 * Extract the terminal class name from a superclass argument.
 * Handles:
 *   - `BaseModel`               → 'BaseModel'
 *   - `pydantic.BaseModel`      → 'BaseModel'
 *   - `a.b.c.BaseModel`         → 'BaseModel'
 *   - `BaseModel[T]`            → 'BaseModel' (subscript)
 *   - `models.Model[T]`         → 'Model' (attribute then subscript)
 *
 * Returns null for keyword arguments (`metaclass=...`) and other shapes.
 */
function extractClassBaseName(node: SyntaxNode): string | null {
  if (node.type === 'identifier') return node.text
  if (node.type === 'attribute') {
    const attr = node.childForFieldName('attribute')
    return attr?.text ?? null
  }
  if (node.type === 'subscript') {
    const value = node.childForFieldName('value')
    if (value) return extractClassBaseName(value)
  }
  return null
}

/**
 * True if `name` looks like a Python authentication decorator name.
 *
 * Covers common Django/Flask/FastAPI auth decorators:
 *   - login_required, permission_required, user_passes_test
 *   - jwt_required, token_required
 *   - requires_auth, require_login
 *   - authenticated_only
 */
export function isPythonAuthDecoratorName(name: string): boolean {
  if (!name) return false
  return /^(login_required|permission_required|user_passes_test|jwt_required|token_required|requires_auth|require_login|require_auth|authenticated_only|auth_required|require_user|verify_(?:jwt|token|user|auth))$/i.test(
    name,
  )
}
