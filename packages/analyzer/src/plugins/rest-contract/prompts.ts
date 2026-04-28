import type { SpecSection } from '../types.js'

// ---------------------------------------------------------------------------
// Discovery — extract structured REST contract claims from a spec section
// ---------------------------------------------------------------------------

export function buildDiscoveryPrompt(section: SpecSection, codeFiles: string[]): string {
  const filesList = codeFiles.slice(0, 80).map((f) => `- ${f}`).join('\n')
  return `You are extracting REST API contract claims from a project's specification. Each claim is a concrete obligation the implementation must satisfy.

# Spec section
Path: ${section.sourcePath}
Heading: ${section.heading}

## Content
${section.content}

# Available code files (truncated)
${filesList}

# Task
Extract every distinct REST contract obligation stated in the spec section above. Cover the full REST surface, not just status codes and bodies. Skip aspirational, descriptive, or non-prescriptive prose.

REST contract obligations include (non-exhaustive):
- Status codes returned by an endpoint (success and error paths).
- Request body shape, required fields, validation rules.
- Response body shape — including wrapper keys and pagination envelopes.
- Required request headers (Authorization, Content-Type, Idempotency-Key, …).
- Required response headers (Location after POST, ETag, Cache-Control, X-Rate-Limit-*, …).
- Query parameters: name, type, required-ness, format constraints, max bounds.
- Path parameters: format constraint (UUID, slug, integer, …).
- Authentication / authorization requirements (which endpoints, what scheme/scope/role).
- Pagination contract on list endpoints (cursor / limit-offset / max page size).
- Idempotency: endpoint must accept and honor an idempotency key.
- Standardized error envelope shape (e.g. \`{ error: string }\`, RFC 7807 \`application/problem+json\`).
- Accepted / produced content types.
- Versioning (URL prefix or header).
- Entity field schemas: type, format, default, server-assigned, uniqueness, normalization.

**One claim per obligation.** If the spec restates the same obligation in different words, emit it ONCE. Two outputs that, if violated, would mean the same code defect must be merged into one claim.

Examples of WRONG output (paraphrases — pick ONE, drop the other):
  ✗ "GET /users returns 200 with body { users: User[] }"
  ✗ "GET /users response body wraps the user list under the \`users\` key, not a bare array"
  → Same obligation: GET /users response shape. Emit one.

Examples of CORRECT separate claims (distinct obligations on the same endpoint):
  ✓ "POST /users returns 201 on success"
  ✓ "POST /users returns 409 when email already exists"
  ✓ "POST /users sets the Location header to the new resource's URL"
  ✓ "POST /users requires Authorization: Bearer <token>"
  → Four distinct obligations, four claims (status, status, response-header, auth).

For each obligation, emit ONE claim row. The plugin builds the canonical obligationKey deterministically from the structured fields you supply — your job is to identify the obligation and tag it with the correct fields.

For each claim, output:

- **kind**: closed enum, exactly one of:
  \`status-code\` · \`request-body\` · \`response-body\` · \`request-header\` · \`response-header\` · \`query-param\` · \`path-param\` · \`auth\` · \`pagination\` · \`idempotency\` · \`error-envelope\` · \`content-type\` · \`versioning\` · \`field-schema\`

- **claim**: a one-sentence prescriptive statement. Examples:
  • "POST /orders returns 409 when the order is already paid."
  • "GET /users body wraps the array under the \`users\` key."
  • "All /api/v2/* endpoints require Authorization: Bearer <token>."
  • "User.email is unique and lowercased on write."

- **method** + **path** — REQUIRED for every kind EXCEPT \`field-schema\` and repo-wide \`auth\` (which uses \`authScope\`) and \`versioning\` (which uses \`pathPrefix\`). Use the method/path verbatim from the spec. Examples: method=\`GET\`, path=\`/users\`; method=\`DELETE\`, path=\`/users/:id\`.

- **Per-kind discriminator fields** (provide the ones that match the kind; omit the rest):
  • \`status-code\` → REQUIRES \`statusCode\` (integer, e.g. 201, 400, 409).
  • \`request-body\` → optional \`fieldName\` (when the obligation is a field-level rule like "email must contain '@'" or "name must be non-empty"). If the obligation is the overall body shape, omit \`fieldName\`. **Field-level validation rules ARE request-body claims** — never invent a separate "validation" kind.
  • \`response-body\` → no discriminator. Omit \`statusCode\`. Only emit \`response-body\` when the spec mandates a non-trivial body shape (wrapper key like \`{ users: User[] }\`, envelope like \`{ data, meta }\`, or any structure beyond the bare resource). If the body is just the resource ("the user record", "the created order"), DON'T emit response-body — the \`status-code\` claim subsumes it.
  • \`error-envelope\` → REQUIRES \`statusCode\` (the error status this envelope shape applies to).
  • \`request-header\` / \`response-header\` → REQUIRES \`headerName\` (lowercase, e.g. "authorization", "location").
  • \`query-param\` / \`path-param\` → REQUIRES \`paramName\`.
  • \`content-type\` → REQUIRES \`contentType\` (e.g. "application/json").
  • \`auth\` → per-endpoint: just \`method\` + \`path\`. Repo-wide or scope-glob: omit method/path, set \`authScope\` to the scope string (e.g. "*" for repo-wide, "/api/v2/*" for narrower).
  • \`pagination\` / \`idempotency\` → no extra discriminator beyond method+path.
  • \`versioning\` → REQUIRES \`pathPrefix\` (e.g. "/api/v2"). Omit method/path.
  • \`field-schema\` → REQUIRES \`entity\` and \`fieldName\`. Omit method/path. ONE claim per field even when multiple aspects (type + uniqueness + default) apply.

- **sites**: \`{ filePath: string, symbol?: string }[]\` — REQUIRED, non-empty. List EVERY file from the "Available code files" list that implements this obligation. **The plugin will emit one draft per site.** Anchor selection by kind:
  • status-code / request-body / response-body / response-header / pagination / idempotency / content-type / error-envelope → \`handlers/\`, \`controllers/\`, \`routes/\`, \`api/\` files. Match the URL path to the file name when possible.
  • request-header / auth → \`middleware/\`, \`guards/\`, \`interceptors/\`, \`auth/\`. If the check lives inline in the handler, anchor to the handler. Global-mounted middleware → the app/server entry file.
  • query-param / path-param → the validation site (\`validators/\`, \`schemas/\`, zod/yup/joi files) OR the handler that consumes the param.
  • versioning → the route-mount point where the version prefix is applied.
  • field-schema → \`models/\`, \`schemas/\`, \`types/\`, \`prisma/\`, \`drizzle/\`, ORM definitions, zod schemas.
  When an obligation is implemented at N files (same response shape in two services, same handler logic in controller + downstream handler, same field schema declared in two models), put **all N files in \`sites\`**. Each file is a place the obligation can independently drift.
  filePath MUST be one of the paths from the file list (verbatim — do not invent or modify).
  Type-declaration / re-export / pure caller files are NOT sites — exclude them. A site is where the obligation's behavior is actually constructed.
  If you genuinely cannot identify any candidate file, drop the claim entirely (don't emit it).

- **confidence**: 0..1 reflecting how confident you are this is a real, enforceable claim.
- **rationale**: one short sentence on why this is a claim.

**One claim per (kind, endpoint, discriminator) tuple.** Don't emit two rows for the same logical obligation. Don't restate "POST /users returns 201 with the created user" as both a \`status-code\` row and a \`response-body\` row — emit just \`status-code\` (with statusCode=201). The plugin's deterministic key construction means each tuple has exactly one canonical key; emitting the same tuple twice would just dedupe to one anyway.

If the section has no enforceable claims, return an empty array.

# Worked example
Spec section:
> ## POST /users
> - Request body: \`{ name: string; email: string }\`. Email must contain \`@\` and a \`.\` after it; name must be non-empty.
> - Returns 201 with the created user record.
> - Returns 400 with \`{ error: string }\` when validation fails.
> - Returns 409 when the email already exists.

Expected claim rows (assuming the endpoint is implemented in both \`api-gateway/.../user.controller.ts\` and \`user-service/.../user.handler.ts\`):
1. kind=\`status-code\`, method=\`POST\`, path=\`/users\`, statusCode=201, sites=[both files]   — covers "Returns 201 with the created user record" (trivial body, subsumed)
2. kind=\`status-code\`, method=\`POST\`, path=\`/users\`, statusCode=400, sites=[both]
3. kind=\`status-code\`, method=\`POST\`, path=\`/users\`, statusCode=409, sites=[both]
4. kind=\`request-body\`, method=\`POST\`, path=\`/users\`, sites=[both]                          — covers the overall body shape \`{ name, email }\`
5. kind=\`request-body\`, method=\`POST\`, path=\`/users\`, fieldName=\`email\`, sites=[both]      — covers the email format rule
6. kind=\`request-body\`, method=\`POST\`, path=\`/users\`, fieldName=\`name\`, sites=[both]       — covers the name non-empty rule
7. kind=\`error-envelope\`, method=\`POST\`, path=\`/users\`, statusCode=400, sites=[both]        — covers "{ error: string } when validation fails"

Plugin builds keys: \`POST /users status-201\`, \`POST /users status-400\`, \`POST /users status-409\`, \`POST /users request-body\`, \`POST /users request-body:email\`, \`POST /users request-body:name\`, \`POST /users error-envelope:400\`. With sites=2 each, that's 14 drafts (one per file per obligation).
`
}

// ---------------------------------------------------------------------------
// Enforcement — compare a claim against code
// ---------------------------------------------------------------------------

export function buildEnforcementPrompt(args: {
  claim: string
  kind: string
  codeContent: string
  filePath: string
}): string {
  return `You are checking whether code satisfies a REST API contract claim.

# Claim (kind: ${args.kind})
${args.claim}

# Code under review
File: ${args.filePath}

\`\`\`
${args.codeContent}
\`\`\`

# Task
Determine whether the code FULLY implements the behavior the claim prescribes.

Treat the following as VIOLATIONS (return satisfied=false):
- Code returns the WRONG status code, body shape, header value, or field type compared to the claim.
- Code is MISSING a required path the claim mandates — e.g. the spec says "returns 409 when X" and the code has no 409 path; "returns 404 when not found" and the code unconditionally succeeds; "sets Location header" and the response never sets it.
- Code returns a bare value where the spec mandates a wrapped shape (e.g. \`res.json(items)\` vs spec's \`{ items: [...] }\`).
- Required validation, auth check, idempotency handling, or pagination clamp is absent at a site that IS responsible for it.

Return satisfied=true (NOT a violation) in these cases:
- **Wrong file for this kind of claim.** A claim about *runtime behavior* (status set, body shaped, header written, validation performed, auth enforced, ordering applied) checked against a pure type declaration file (TypeScript \`interface\`, \`type\` alias, or model class with no logic) — type declarations cannot enforce runtime obligations; those live in handlers, middleware, validators, repositories, or database constraints. Don't flag drift you can't pin to enforcement code in THIS file.
- **Off-topic file.** The claim is about a specific behavior or entity (e.g. "email validation", "user creation") but the file under review has no code referencing the relevant entity (no functions, types, or identifiers mentioning the subject of the claim). The file may have a misleading name (e.g. \`validation.ts\` that actually validates score ranges, not email). When the file's actual content is unrelated to the claim's subject, return satisfied=true — this is wrong-anchor, not drift.
- **Non-implementing file for the claim's machinery.** A file is only a real implementation site if it actually constructs the obligated behavior. The required machinery depends on the claim:
  • status-code / request-body / response-body / response-header / pagination / idempotency / content-type claims → file must have HTTP machinery: \`req\`/\`res\`/\`reply\`/\`ctx\` parameters, \`res.status(...)\` / \`res.json(...)\` / \`reply.code(...)\` / \`res.setHeader(...)\` / equivalent response-construction calls, or Express/Fastify/Koa/Hono/etc. imports. A stub class with similarly-named methods (e.g. \`create()\`, \`getById()\`) that returns plain values without shaping an HTTP response is NOT a site.
  • auth / request-header claims → file must have request-pipeline machinery: middleware/guard/interceptor signature (\`(req, res, next)\` or framework equivalent), header-reading calls (\`req.headers[...]\`, \`req.get(...)\`), or a guard decorator. A constants/types file listing header names is NOT a site.
  • query-param / path-param claims → file must read the parameter (\`req.query.x\`, \`req.params.x\`) or declare a validator schema for it. A file that only exports the param name as a string constant is NOT a site.
  • error-envelope claims → file must shape the error response (write status + JSON body) or be a registered error handler. A file that only defines an Error class is NOT a site.
  • versioning claims → file must mount routes with the version prefix or read a version header. A constants file with the version string is NOT a site.
  • field-schema (runtime aspects: uniqueness, normalization, server-assigned, default) → file must have runtime checks, persistence calls, or schema declarations with constraint metadata (e.g. \`@unique\`, zod \`.toLowerCase()\`, ORM column with \`unique: true\`). A pure type/interface declaration is NOT a site for runtime aspects (it IS a site for purely structural aspects — see next point).
  In every case the file may have method names or identifiers that match the claim's subject — that is not enough. Without the actual machinery to enforce the obligation, the file cannot violate it. Return satisfied=true.
- **Structural-only claim that the file's structure satisfies.** A claim "field X is type Y" against an interface that declares \`x: Y\` is satisfied even if other runtime properties (uniqueness etc.) aren't expressed there.
- **Vague or irrelevant claim** that doesn't pin down concrete behavior verifiable in this file.

Treat as satisfied ONLY when the code implements EVERY concrete behavior the claim prescribes that THIS file is responsible for. Partial implementation in a file that IS responsible is a violation; absence of a runtime check in a file that's NOT responsible (e.g. type declaration) is fine.

Output:
- If the code satisfies the claim: \`{ "satisfied": true }\`.
- Otherwise: \`{ "satisfied": false, "lineStart": <number>, "lineEnd": <number>, "message": <one-sentence problem statement>, "fixSuggestion": <one-sentence fix> }\`. Pick \`lineStart\`/\`lineEnd\` to point at the specific line(s) where the drift lives (or the function declaration if the violation is "missing required code").
`
}
