/**
 * ohm-js grammar for the TrueCourse `.tc` contract DSL.
 *
 * This is the STRICT, per-kind grammar for the `.tc` DSL and the single source of
 * truth for its syntax (lexical rules + per-kind artifact bodies). Unlike the hand-written parser (which is
 * artifact-agnostic and accepts almost any brace-and-token soup), this grammar
 * recognizes exactly the clauses each artifact kind admits and rejects unknown
 * top-level/clause constructs.
 *
 * ohm specifics honored here:
 *   - Syntactic rules (Uppercase) auto-skip whitespace; `space += comment`
 *     extends that to both comment forms, so newlines are NOT statement
 *     terminators. Every clause is therefore STRUCTURALLY bounded — no
 *     unbounded `HeadToken*` tail that would run into the next statement.
 *     (The few clauses with a genuine `HeadToken*` tail —
 *     `depends-on`, the query-rule raw-predicate tail, `forbid emission` — are
 *     bounded to the specific shapes that occur, per the gotchas.)
 *   - `kw<k> = k ~identCont` keyword guard so `field` never matches the prefix
 *     of `fieldName` and `in` never matches `index`.
 *   - `reference` is a single lexical token (lexical, lowercase rule) listed
 *     before `ident` everywhere both are admissible.
 *   - Differing-arity alternatives use inline case labels (`-- name`); every
 *     labeled alternative is a Phase-2 semantic-action surface.
 */
import * as ohm from 'ohm-js';

export const TC_GRAMMAR_SOURCE = String.raw`
Tc {
  /* ======================================================================
     File / artifact dispatch
     ====================================================================== */
  File = Artifact*

  Artifact =
      OperationArtifact
    | EntityArtifact
    | EnumArtifact
    | StateMachineArtifact
    | AuthRequirementArtifact
    | AuthorizationRuleArtifact
    | ErrorEnvelopeArtifact
    | PaginationContractArtifact
    | IdempotencyContractArtifact
    | EffectGroupArtifact
    | FormulaArtifact
    | QueryRuleArtifact
    | ForbiddenArtifactArtifact
    | ConstantArtifact
    | ArchitectureDecisionArtifact
    | ValidationRuleArtifact
    | FallbackArtifact
    | FieldExposureArtifact
    | UnenforceableObligationArtifact

  OperationArtifact               = kw<"operation"> Method string OperationBody
  EntityArtifact                  = kw<"entity"> ident EntityBody
  EnumArtifact                    = kw<"enum"> ident EnumBody
  StateMachineArtifact            = kw<"state-machine"> ident StateMachineBody
  AuthRequirementArtifact         = kw<"auth-requirement"> ident AuthReqBody
  AuthorizationRuleArtifact       = kw<"authorization-rule"> ident AuthzBody
  ErrorEnvelopeArtifact           = kw<"error-envelope"> ident EnvBody
  PaginationContractArtifact      = kw<"pagination-contract"> ident PagBody
  IdempotencyContractArtifact     = kw<"idempotency-contract"> ident IdemBody
  EffectGroupArtifact             = kw<"effect-group"> ident EffBody
  FormulaArtifact                 = kw<"formula"> ident FmlBody
  QueryRuleArtifact               = kw<"query-rule"> ident QrBody
  ForbiddenArtifactArtifact       = kw<"forbidden-artifact"> ident FbdBody
  ConstantArtifact                = kw<"constant"> ident ConstBody
  ArchitectureDecisionArtifact    = kw<"architecture-decision"> ident ArchBody
  ValidationRuleArtifact          = kw<"validation-rule"> ident ValRuleBody
  FallbackArtifact                = kw<"fallback"> ident FbkBody
  FieldExposureArtifact           = kw<"field-exposure"> ident FldExpBody
  UnenforceableObligationArtifact = kw<"unenforceable-obligation"> ident UnenfBody

  Method = ident   /* conventionally GET | POST | PUT | PATCH | DELETE */

  /* ======================================================================
     Shared provenance clauses (read by the resolver from any body)
     ====================================================================== */
  Provenance =
      kw<"origin"> OriginSource string range?                       -- origin
    | kw<"inferred-from"> string range?                             -- inferred
    | kw<"confidence"> (kw<"high"> | kw<"medium"> | kw<"low">)      -- confidence
  OriginSource = ident | string

  /* ======================================================================
     3.1  operation
     ====================================================================== */
  OperationBody = "{" OperationStmt* "}"
  OperationStmt =
      OpStatusStmt
    | OpTagsStmt
    | OpResponseStmt
    | OpRequestStmt
    | OpPreconditionsStmt
    | Provenance

  OpStatusStmt = kw<"status"> OpStatus
  OpStatus =
      kw<"shipped"> | kw<"planned"> | kw<"deferred"> | kw<"deprecated"> | kw<"out-of-scope">

  OpTagsStmt = kw<"tags"> List

  /* Two forms: 'response NUM inherits Ref' (no block) and
     'response NUM on <cond> { ... }'. The 'on' and the block are both optional
     so a bare 'response 200' and 'response 200 on success { }' both match. */
  OpResponseStmt = kw<"response"> OpRespStatus OpRespTail
  OpRespStatus = statusClass | number
  OpRespTail =
      kw<"inherits"> reference          -- inherits
    | OpRespOn? OpRespBlock?            -- on
  OpRespOn = kw<"on"> ident
  OpRespBlock = "{" OpRespInner* "}"
  OpRespInner =
      OpHeaderStmt
    | OpEffectStmt
    | OpForbidStmt
    | OpBodyStmt

  OpHeaderStmt = kw<"header"> ident OpHeaderMod*
  OpHeaderMod =
      kw<"required">                 -- required
    | kw<"optional">                 -- optional
    | kw<"idempotent-under">         -- idempotentUnder
    | kw<"value"> string             -- value
    | kw<"format"> string            -- format

  OpEffectStmt = kw<"effect"> OpEffectVerb reference (kw<"to"> ident)?
  OpEffectVerb = kw<"emits"> | kw<"persist"> | kw<"state-transition">

  OpForbidStmt =
      kw<"forbid"> kw<"status"> number (kw<"when"> ident)?   -- status
    | kw<"forbid"> kw<"query-param"> ident                   -- queryParam
    | kw<"forbid"> kw<"emission"> OpForbidEmissionTail        -- emission
  OpForbidEmissionTail = (kw<"when-response-status"> List)?

  /* Three body forms, in lifter-checked order: envelope, ref, inline. */
  OpBodyStmt =
      kw<"body"> kw<"envelope"> reference "{" OpErrorCodeStmt* "}"   -- envelope
    | kw<"body"> reference                                          -- ref
    | kw<"body"> "{" OpFieldDecl* "}"                               -- inline
  OpErrorCodeStmt =
      kw<"error-code"> kw<"one-of"> List   -- oneOf
    | kw<"error-code"> ident               -- single

  OpFieldDecl = ident ":" OpFieldType OpFieldMod*
  OpFieldType =
      kw<"array"> kw<"element"> (reference | ident)   -- array
    | OpFieldAtom ("|" OpFieldAtom)*                   -- union
  OpFieldAtom = reference | ident
  OpFieldMod =
      kw<"required">                                  -- required
    | kw<"optional">                                  -- optional
    | kw<"references"> reference                      -- references
    | kw<"constraint"> ident                          -- constraint
    | compareNum number                               -- compareNum
    | kw<"default"> (number | string | ident)         -- default
    | kw<"min"> number                                -- min
    | kw<"max"> number                                -- max
    | kw<"format"> ident                              -- format
    | kw<"semantics"> ident                           -- semantics
  compareNum = ">=" | "<=" | ">" | "<" | "=="

  /* request block — recognized clause, not yet lifted. */
  OpRequestStmt = kw<"request"> "{" OpReqInner* "}"
  OpReqInner =
      OpHeaderStmt
    | OpPathParamStmt
    | OpQueryStmt
    | OpBodyStmt
  OpPathParamStmt = kw<"path-param"> ident ":" OpFieldType OpFieldMod* OpOnInvalidBlock?
  OpOnInvalidBlock = "{" OpOnInvalidStmt* "}"
  OpOnInvalidStmt = kw<"on-invalid"> kw<"status"> number kw<"error-code"> ident
  OpQueryStmt = kw<"query"> "{" OpQueryParam* "}"
  OpQueryParam = ident ":" OpFieldType OpFieldMod* OpQueryParamBlock?
  OpQueryParamBlock = "{" OpQueryParamConstraint* "}"
  OpQueryParamConstraint =
      kw<"default"> (number | string | ident)   -- default
    | kw<"min"> number                           -- min
    | kw<"max"> number                           -- max
    | kw<"on-above-max"> ident                   -- onAboveMax
    | kw<"semantics"> ident                      -- semantics

  /* preconditions block — recognized clause, not yet lifted. */
  OpPreconditionsStmt = kw<"preconditions"> "{" OpPreInner* "}"
  OpPreInner = kw<"state-transition"> reference "{" OpTransitionEdge* "}"
  OpTransitionEdge =
      kw<"from"> (List | ident)   -- from
    | kw<"to"> (List | ident)     -- to

  /* ======================================================================
     3.2  entity
     ====================================================================== */
  EntityBody = "{" EntityStmt* "}"
  EntityStmt = EntFieldDecl | Provenance

  EntFieldDecl = kw<"field"> ident ":" EntFieldType EntFieldMod* EntFieldBlock?
  EntFieldBlock = "{" EntFieldMod* "}"

  EntFieldType =
      reference                                            -- ref
    | EntFormat EntTypeConstraint*                         -- format
    | EntPrimitive EntTypeUnion? EntTypeConstraint*        -- prim
  EntFormat = kw<"uuid"> | kw<"email"> | kw<"iso-8601">
  EntPrimitive =
      kw<"string"> | kw<"integer"> | kw<"number"> | kw<"boolean"> | kw<"object"> | kw<"array">
  EntTypeUnion = "|" ident
  EntTypeConstraint = (">=" | "<=" | ">" | "<") (number | ident)

  EntFieldMod =
      kw<"immutable">                          -- immutable
    | kw<"mutable">                            -- mutable
    | kw<"unique">                             -- unique
    | kw<"optional">                           -- optional
    | kw<"required">                           -- required
    | kw<"origin"> ident                       -- origin
    | kw<"mutability"> ident                   -- mutability
    | kw<"normalize"> ident                    -- normalize
    | kw<"format"> ident                       -- format
    | kw<"references"> reference               -- references
    | kw<"bound-to"> reference                 -- boundTo
    | kw<"derived-by"> reference               -- derivedBy
    | kw<"default"> (ident | string | number)  -- default
    | kw<"constraint"> (ident | string)        -- constraint

  /* ======================================================================
     3.3  enum
     ====================================================================== */
  EnumBody = "{" EnumStmt* "}"
  EnumStmt =
      kw<"representation"> ident?         -- repr
    | kw<"closed">                        -- closed
    | kw<"open">                          -- open
    | kw<"values"> List                   -- values
    | kw<"trigger-subset"> ident List     -- trigger
    | Provenance                          -- prov

  /* ======================================================================
     3.4  state-machine
     ====================================================================== */
  StateMachineBody = "{" StateMachineStmt* "}"
  StateMachineStmt =
      kw<"states"> reference                       -- states
    | kw<"initial"> List                           -- initial
    | kw<"terminal"> List                          -- terminal
    | kw<"transitions"> "{" SmTransition* "}"      -- transitions
    | kw<"scope"> "{" SmScopeStmt* "}"             -- scope
    | Provenance                                   -- prov
  SmTransition = ident "->" (List | ident)
  SmScopeStmt =
      kw<"entity"> reference   -- entity
    | kw<"field"> ident        -- field

  /* ======================================================================
     3.5  auth-requirement
     ====================================================================== */
  AuthReqBody = "{" AuthReqStmt* "}"
  AuthReqStmt =
      kw<"scheme"> ident                        -- scheme
    | kw<"required-role"> ident                 -- requiredRole
    | kw<"selector"> SelectorExpr               -- selector
    | kw<"except"> "{" AuthExceptInner* "}"     -- except
    | kw<"on-violation"> "{" OnViolationInner* "}"  -- onViolation
    | Provenance                                -- prov
  AuthExceptInner = SelectorExpr

  /* selector expression — the closed set parseSelector recognizes. */
  SelectorExpr =
      kw<"path-glob"> string    -- pathGlob
    | kw<"path-exact"> string   -- pathExact
    | kw<"path-regex"> string   -- pathRegex
    | kw<"tag"> ident           -- tag
    | kw<"method"> ident        -- method
    | kw<"operations"> List     -- operations

  /* on-violation inner — one clause per line; the recognized forms plus body. */
  OnViolationInner =
      kw<"status"> number       -- status
    | kw<"error-code"> ident    -- errorCode
    | kw<"body"> reference       -- body

  /* ======================================================================
     3.6  authorization-rule
     ====================================================================== */
  AuthzBody = "{" AuthzStmt* "}"
  AuthzStmt =
      kw<"applies-to"> "{" AuthzAppliesToInner* "}"   -- appliesTo
    | kw<"predicate"> string                          -- predicate
    | kw<"except"> "{" AuthzExceptInner* "}"          -- except
    | kw<"on-violation"> "{" OnViolationInner* "}"    -- onViolation
    | Provenance                                      -- prov
  AuthzAppliesToInner = kw<"operations"> List
  AuthzExceptInner = kw<"role"> ident

  /* ======================================================================
     3.7  error-envelope
     ====================================================================== */
  EnvBody = "{" EnvStmt* "}"
  EnvStmt =
      kw<"applies-to"> kw<"status-class">? List    -- appliesTo
    | kw<"known-codes"> List                        -- knownCodes
    | kw<"shape"> "{" EnvShapeMember* "}"           -- shape
    | Provenance                                    -- prov
  EnvShapeMember = EnvFieldDecl | EnvShapeObject
  EnvShapeObject = ident "{" EnvShapeMember* "}"
  EnvFieldDecl = kw<"field"> ident ":" ident EnvFieldMod*
  EnvFieldMod =
      kw<"format"> ident   -- format
    | kw<"required">       -- required
    | kw<"optional">       -- optional

  /* ======================================================================
     3.8  pagination-contract
     ====================================================================== */
  PagBody = "{" PagStmt* "}"
  PagStmt =
      kw<"scheme"> ident                              -- scheme
    | kw<"query"> "{" PagParam* "}"                   -- query
    | kw<"forbids"> "{" PagForbidLine* "}"            -- forbids
    | kw<"selector"> SelectorExpr                     -- selector
    | kw<"response-shape"> "{" PagShapeField* "}"     -- responseShape
    | Provenance                                      -- prov
  PagParam = ident ":" ident PagModifier* PagParamBlock?
  PagParamBlock = "{" PagModifier* "}"
  PagModifier =
      kw<"optional">                  -- optional
    | kw<"required">                  -- required
    | kw<"min"> number                -- min
    | kw<"max"> number                -- max
    | kw<"default"> (number | string) -- default
    | kw<"on-above-max"> ident        -- onAboveMax
    | kw<"semantics"> ident           -- semantics
  PagForbidLine = kw<"forbid"> kw<"query-param"> ident
  PagShapeField = ident ":" PagShapeType
  PagShapeType = PagTypeAtom ("|" PagTypeAtom)*
  PagTypeAtom = reference | ident

  /* ======================================================================
     3.9  idempotency-contract
     ====================================================================== */
  IdemBody = "{" IdemStmt* "}"
  IdemStmt =
      kw<"request-header"> ident          -- requestHeader
    | kw<"semantics"> ident               -- semantics
    | kw<"selector"> SelectorExpr         -- selector
    | Provenance                          -- prov

  /* ======================================================================
     3.10  effect-group
     ====================================================================== */
  EffBody = "{" EffStmt* "}"
  EffStmt =
      kw<"channel"> ident                                  -- channel
    | kw<"payload-shape"> "{" EffPayloadField* "}"         -- payloadShape
    | kw<"effect"> ident "{" EffEffectInner* "}"           -- effect
    | kw<"forbids"> "{" EffForbidStmt* "}"                 -- forbids
    | Provenance                                           -- prov
  EffPayloadField = ident ":" (reference | ident)
  EffEffectInner =
      kw<"emit-when"> "{" EffEmitWhenStmt* "}"                            -- emitWhen
    | kw<"payload-constraint"> ident "=" (string | number | ident)       -- payloadConstraint
  EffEmitWhenStmt =
      kw<"operation"> reference                  -- operation
    | kw<"on-status"> (string | number | ident)  -- onStatus
  EffForbidStmt = kw<"forbid"> kw<"emission"> (kw<"when-response-status"> List)?

  /* ======================================================================
     3.11  formula
     ====================================================================== */
  FmlBody = "{" FmlStmt* "}"
  FmlStmt =
      kw<"output"> reference kw<"field"> ident   -- output
    | kw<"inputs"> List                           -- inputs
    | kw<"expression"> FmlExpressionVal           -- expression
    | kw<"computed-at"> ident                     -- computedAt
    | kw<"immutable-after-creation">              -- immutableAfter
    | kw<"depends-on"> FmlDependsOnVal            -- dependsOn
    | Provenance                                  -- prov
  /* expression: string (optionally + block), or block alone, or bare. */
  FmlExpressionVal =
      string FmlConditional?   -- stringForm
    | FmlConditional           -- blockForm
    |                          -- bare
  FmlConditional = "{" FmlConditionalStmt* "}"
  FmlConditionalStmt =
      kw<"when"> string   -- when
    | kw<"then"> string   -- then
    | kw<"else"> string   -- else
  /* depends-on: a single Reference or a List of References (or bare). */
  FmlDependsOnVal =
      List        -- list
    | reference   -- ref
    |             -- bare

  /* ======================================================================
     3.12  query-rule
     ====================================================================== */
  QrBody = "{" QrStmt* "}"
  QrStmt =
      kw<"bound-to"> reference                         -- boundTo
    | kw<"entity"> reference                           -- entity
    | kw<"date-range-binding"> kw<"column"> column     -- dateRange
    | kw<"required"> "{" QrPredicate* "}"              -- required
    | kw<"forbidden"> "{" QrPredicate* "}"             -- forbidden
    | Provenance                                       -- prov

  QrPredicate =
      kw<"raw"> string                                                  -- raw
    | (kw<"is-null"> | kw<"is-not-null">) column                        -- nullary
    | (kw<"eq"> | kw<"neq"> | kw<"gte"> | kw<"gt"> | kw<"lte"> | kw<"lt">) column QrValue  -- binary
    | (kw<"not-in"> | kw<"in">) column List                            -- listpred
    | kw<"between"> column QrValue QrValue                              -- between
    | (kw<"ilike"> | kw<"like">) column string                         -- pattern
    | (kw<"eq-col"> | kw<"neq-col"> | kw<"gte-col"> | kw<"gt-col"> | kw<"lte-col"> | kw<"lt-col">) column column  -- colCmpKw
    | kw<"col-cmp"> column QrCompareOp column                           -- colCmp
    | ident QrPredHeadTok*                                              -- raw_fallback
  QrValue = string | number | kw<"true"> | kw<"false"> | kw<"null"> | ident
  column = ident
  QrCompareOp = "=" | "==" | "!=" | ">=" | "<=" | ">" | "<"
  /* Tail of an unrecognized predicate, re-serialized verbatim — full op set. */
  QrPredHeadTok = reference | range | List | string | number | ident | op

  /* ======================================================================
     3.13  forbidden-artifact
     ====================================================================== */
  FbdBody = "{" FbdStmt* "}"
  FbdStmt =
      kw<"category"> ident   -- category
    | kw<"pattern"> string   -- pattern
    | kw<"reason"> string    -- reason
    | Provenance             -- prov

  /* ======================================================================
     3.14  constant
     ====================================================================== */
  ConstBody = "{" ConstStmt* "}"
  ConstStmt =
      kw<"type"> ConstTypeVal                          -- type
    | kw<"expected-value"> "{" ConstObjectEntry* "}"   -- evBlock
    | kw<"expected-value"> ConstInlineValue            -- evInline
    | Provenance                                       -- prov
  ConstTypeVal =
      kw<"string"> | kw<"number"> | kw<"boolean"> | kw<"object"> | kw<"array">
  ConstObjectEntry = (ident | string) ":" ConstInlineValue
  ConstInlineValue =
      string
    | number
    | kw<"true">
    | kw<"false">
    | kw<"null">
    | List
    | ident

  /* ======================================================================
     3.15  architecture-decision
     ====================================================================== */
  ArchBody = "{" ArchStmt* "}"
  ArchStmt =
      kw<"category"> ident                               -- category
    | kw<"chosen"> HeadToken                             -- chosen
    | kw<"reason"> string                                -- reason
    | kw<"rejected-alternatives"> List                   -- rejectedAlternatives
    | kw<"consequences"> List                            -- consequences
    | kw<"scope"> "{" ArchScopeStmt* "}"                 -- scope
    /* decision "..." is legitimate authored prose — a recognized clause the
       grammar admits but the lifter does not yet read into the typed contract. */
    | kw<"decision"> string                              -- decision
    | Provenance                                         -- prov
  ArchScopeStmt = kw<"path-glob"> string

  /* ======================================================================
     3.15.5  validation-rule (conditional field-requiredness / required-when)
     The 'when' clause reuses the query-rule predicate vocabulary verbatim
     (QrPredicate) so a setting condition is expressed with the same algebra
     as a query filter — no new comparison grammar.
     ====================================================================== */
  ValRuleBody = "{" ValRuleStmt* "}"
  ValRuleStmt =
      kw<"target"> ident                                  -- target
    | kw<"when"> QrPredicate                              -- when
    | kw<"actor"> ident                                   -- actor
    | kw<"effect"> ValRuleEffect                          -- effect
    | kw<"on-violation"> "{" ValRuleOnViolationInner* "}" -- onViolation
    | Provenance                                          -- prov
  ValRuleEffect = kw<"required"> | kw<"optional"> | kw<"forbidden">
  ValRuleOnViolationInner =
      kw<"status"> number       -- status
    | kw<"error-code"> ident    -- errorCode

  /* ======================================================================
     3.15.6  fallback (null/absent -> default RUNTIME coalescing rule)
     A standalone "when <target> is null/absent, fall back to <default>" rule
     that lives in CODE, distinct from a schema/DB column default. The default
     value reuses the constant inline-value forms (string/number/bool/null/
     ident) so there is no new scalar-value grammar.
     ====================================================================== */
  FbkBody = "{" FbkStmt* "}"
  FbkStmt =
      kw<"target"> (reference | ident)   -- target
    | kw<"when"> FbkTrigger              -- when
    | kw<"default"> FbkValue             -- default
    | Provenance                         -- prov
  FbkTrigger = kw<"null-or-absent"> | kw<"absent"> | kw<"null">
  FbkValue =
      string
    | number
    | kw<"true">
    | kw<"false">
    | kw<"null">
    | ident

  /* ======================================================================
     3.15.7  field-exposure (a field that MUST be exposed on a read path)
     A field is included in a data-access projection (query-select) and/or
     returned in an API response (api-response). 'via' repeats once per
     channel; 'in' optionally names the operation/query it is exposed through
     (a Reference when named, a bare ident otherwise). The 'field' target
     reuses the (Reference | ident) dual shape fallback's target uses — an
     Entity:E.field reference OR a bare field ident — so there is no new
     target grammar.
     ====================================================================== */
  FldExpBody = "{" FldExpStmt* "}"
  FldExpStmt =
      kw<"field"> (reference | ident)        -- field
    | kw<"via"> FldExpChannel                -- via
    | kw<"in"> (reference | ident | string)  -- in
    | Provenance                             -- prov
  FldExpChannel = kw<"query-select"> | kw<"api-response">

  /* ======================================================================
     3.16  unenforceable-obligation
     ====================================================================== */
  UnenfBody = "{" UnenfStmt* "}"
  UnenfStmt =
      kw<"spec-text"> string                            -- specText
    | kw<"category"> (ident | string)                   -- category
    | kw<"rationale"> string                            -- rationale
    | kw<"could-become-enforceable-via"> reference      -- couldBecomeEnforceableVia
    | Provenance                                        -- prov

  /* ======================================================================
     Shared list + generic head token (for raw-predicate re-serialization)
     ====================================================================== */
  List = "[" ListItem* "]"
  ListItem = (reference | range | statusClass | number | string | ident | op) ","?

  HeadToken = reference | range | statusClass | number | string | List | ident | op

  /* ======================================================================
     Lexical rules. Lowercase rules — no implicit
     whitespace skipping; these are the leaf tokens.
     ====================================================================== */
  kw<k> = k ~identCont
  /* ident, optionally with a trailing call/precision group:
       NOW()            SQL function literal
       numeric(4,3)     type-precision notation
     The old lexer read the bare word as one token then folded the following
     paren group into its value (concatenating inner token text, so any
     interior whitespace collapsed). The ident semantic action reproduces that
     fold and whitespace-strip so values stay byte-identical. */
  ident = identStart identCont* identCall?
  identCall = "(" (~")" any)* ")"
  identStart = letter | "_" | "$"
  identCont = identStart | digit | "-" | "."

  /* reference: a single lexical token — PascalCase ident ':' (string | ident).
     Captured raw; escapes NOT decoded inside the quoted identity. */
  reference = upper identCont* ":" (refQuoted | ident)
  refQuoted = "\"" (~"\"" any)* "\""

  string = "\"" stringChar* "\""
  stringChar = "\\" any   -- escape
             | ~"\"" any  -- plain

  /* statusClass tried before number in list/status positions: digit+ 'xx'. */
  statusClass = digit+ "xx"

  /* number: '-'? digit+ ('.' digit+)? — fraction only when '.' is followed by
     a digit, so 'a..b' lexes as number '..' number, not swallowing the dot. */
  number = "-"? digit+ ("." digit+)?

  /* range: two numbers around '..'; either endpoint may be negative. */
  range = rangeInt ".." rangeInt
  rangeInt = "-"? digit+

  /* the operator head-tokens the old lexer produces. */
  op = ".." | "->" | ">=" | "<=" | "==" | "!=" | ">" | "<" | ":" | "=" | "|"

  /* whitespace + both comment forms produce no token. */
  space += comment
  comment = lineComment | blockComment
  lineComment = "//" (~"\n" any)*
  blockComment = "/*" (~"*/" any)* "*/"
}
`;

export const tcGrammar = ohm.grammar(TC_GRAMMAR_SOURCE);
