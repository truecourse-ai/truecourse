import { describe, it, expect } from "vitest";
import {
  deriveClosedKeywordSets,
  renderClosedKeywordSets,
  renderGrammarKeywordReference,
} from "../../packages/contract-verifier/src/parser-ohm/keyword-sets.js";
import { TC_GRAMMAR_SOURCE } from "../../packages/contract-verifier/src/parser-ohm/grammar.js";

// The closed keyword sets are DERIVED from the ohm grammar source, so this
// reference tracks the grammar automatically — no hand-maintained list.
describe("grammar-derived closed keyword sets", () => {
  it("renders deterministically (two renders are byte-identical)", () => {
    expect(renderGrammarKeywordReference()).toBe(renderGrammarKeywordReference());
    expect(renderGrammarKeywordReference(TC_GRAMMAR_SOURCE)).toBe(
      renderGrammarKeywordReference(TC_GRAMMAR_SOURCE),
    );
  });

  it("captures FldExpChannel as EXACTLY the two via channels", () => {
    const chan = deriveClosedKeywordSets(TC_GRAMMAR_SOURCE).find((s) => s.rule === "FldExpChannel");
    expect(chan?.keywords).toEqual(["query-select", "api-response"]);
  });

  it("lists constraint among the operation-field modifiers", () => {
    const mod = deriveClosedKeywordSets(TC_GRAMMAR_SOURCE).find((s) => s.rule === "OpFieldMod");
    expect(mod?.keywords).toContain("constraint");
  });

  it("includes the known closed-set rules", () => {
    const names = new Set(deriveClosedKeywordSets(TC_GRAMMAR_SOURCE).map((s) => s.rule));
    for (const rule of [
      "FldExpChannel",
      "OpFieldMod",
      "EntFieldMod",
      "OpHeaderMod",
      "FbkTrigger",
      "OpEffectVerb",
      "EnumStmt",
      "SelectorExpr",
      "QrPredicate",
    ]) {
      expect(names.has(rule)).toBe(true);
    }
  });

  it("excludes single-keyword clauses and bare-operator sets", () => {
    const names = new Set(deriveClosedKeywordSets(TC_GRAMMAR_SOURCE).map((s) => s.rule));
    // A single leading keyword is not a closed SET.
    expect(names.has("OpStatusStmt")).toBe(false);
    // compareNum is a pure operator alternation — expanded inline, never its own entry.
    expect(names.has("compareNum")).toBe(false);
  });

  it("is sensitive: adding a keyword to a closed set changes the output", () => {
    const base = renderGrammarKeywordReference(TC_GRAMMAR_SOURCE);
    const variant = TC_GRAMMAR_SOURCE.replace(
      `FldExpChannel = kw<"query-select"> | kw<"api-response">`,
      `FldExpChannel = kw<"query-select"> | kw<"api-response"> | kw<"response-header">`,
    );
    expect(variant).not.toBe(TC_GRAMMAR_SOURCE); // guard: the replace actually matched
    expect(base).not.toContain("response-header");
    const changed = renderGrammarKeywordReference(variant);
    expect(changed).not.toBe(base);
    expect(changed).toContain("FldExpChannel: query-select | api-response | response-header");
    const chan = deriveClosedKeywordSets(variant).find((s) => s.rule === "FldExpChannel");
    expect(chan?.keywords).toEqual(["query-select", "api-response", "response-header"]);
  });

  it("selects rules mechanically from an arbitrary grammar source", () => {
    const mini = String.raw`
Mini {
  Via = kw<"a"> | kw<"b">
  Mod = kw<"x"> ident | kw<"y"> | ref
  Solo = kw<"only"> ident
  Ops = ">=" | "<="
  ident = "i"
  ref = "r"
}`;
    const byName = new Map(deriveClosedKeywordSets(mini).map((s) => [s.rule, s]));
    expect(byName.get("Via")?.keywords).toEqual(["a", "b"]);
    expect(byName.get("Mod")?.keywords).toEqual(["x", "y"]); // 2 distinct kw + a bare form
    expect(byName.has("Solo")).toBe(false); // single keyword
    expect(byName.has("Ops")).toBe(false); // operator-only, expanded inline elsewhere
  });

  it("render(derive(x)) equals the convenience renderer", () => {
    expect(renderClosedKeywordSets(deriveClosedKeywordSets(TC_GRAMMAR_SOURCE))).toBe(
      renderGrammarKeywordReference(TC_GRAMMAR_SOURCE),
    );
  });

  it("matches the pinned rendered snapshot", () => {
    const EXPECTED = `Provenance: origin <origin-source> <string> <range> | inferred-from <string> <range> | confidence (high | medium | low)
OpStatus: shipped | planned | deferred | deprecated | out-of-scope
OpHeaderMod: required | optional | idempotent-under | value <string> | format <string>
OpEffectVerb: emits | persist | state-transition
OpFieldMod: required | optional | references <ref> | constraint <ident> | >=|<=|>|<|== <number> | default (<number> | <string> | <ident>) | min <number> | max <number> | format <ident> | semantics <ident>
OpQueryParamConstraint: default (<number> | <string> | <ident>) | min <number> | max <number> | on-above-max <ident> | semantics <ident>
OpTransitionEdge: from (<list> | <ident>) | to (<list> | <ident>)
EntFormat: uuid | email | iso-8601
EntPrimitive: string | integer | number | boolean | object | array
EntFieldMod: immutable | mutable | unique | optional | required | origin <ident> | mutability <ident> | computed-at <ident> | normalize <ident> | format <ident> | references <ref> | bound-to <ref> | derived-by <ref> | default (<ident> | <string> | <number>) | constraint (<ident> | <string>)
EnumStmt: representation <ident> | closed | open | values <list> | trigger-subset <ident> <list> | <provenance>
StateMachineStmt: states <ref> | initial <list> | terminal <list> | transitions { … } | scope { … } | <provenance>
SmScopeStmt: entity <ref> | field <ident>
AuthReqStmt: scheme <ident> | required-role <ident> | selector <selector-expr> | except { … } | on-violation { … } | <provenance>
SelectorExpr: path-glob <string> | path-exact <string> | path-regex <string> | tag <ident> | method <ident> | operations <list>
OnViolationInner: status <number> | error-code <ident> | body <ref>
AuthzStmt: applies-to { … } | predicate <string> | except { … } | on-violation { … } | <provenance>
EnvStmt: applies-to status-class <list> | known-codes <list> | shape { … } | <provenance>
EnvFieldMod: format <ident> | required | optional
PagStmt: scheme <ident> | query { … } | forbids { … } | selector <selector-expr> | response-shape { … } | <provenance>
PagModifier: optional | required | min <number> | max <number> | default (<number> | <string>) | on-above-max <ident> | semantics <ident>
IdemStmt: request-header <ident> | semantics <ident> | selector <selector-expr> | <provenance>
EffStmt: channel <ident> | payload-shape { … } | effect <ident> { … } | forbids { … } | <provenance>
EffEffectInner: emit-when { … } | payload-constraint <ident> = (<string> | <number> | <ident>)
EffEmitWhenStmt: operation <ref> | on-status (<string> | <number> | <ident>)
FmlStmt: output <ref> field <ident> | inputs <list> | expression <fml-expression-val> | computed-at <ident> | immutable-after-creation | depends-on <fml-depends-on-val> | <provenance>
FmlConditionalStmt: when <string> | then <string> | else <string>
QrStmt: bound-to <ref> | entity <ref> | date-range-binding column <column> | required { … } | forbidden { … } | <provenance>
QrPredicate: raw <string> | is-null|is-not-null <column> | eq|neq|gte|gt|lte|lt <column> <qr-value> | not-in|in <column> <list> | between <column> <qr-value> <qr-value> | ilike|like <column> <string> | eq-col|neq-col|gte-col|gt-col|lte-col|lt-col <column> <column> | col-cmp <column> =|==|!=|>=|<=|>|< <column> | <ident> <qr-pred-head-tok>
QrValue: <string> | <number> | true | false | null | <ident>
FbdStmt: category <ident> | pattern <string> | reason <string> | <provenance>
ConstStmt: type <const-type-val> | expected-value { … } | expected-value <const-inline-value> | <provenance>
ConstTypeVal: string | number | boolean | object | array
ConstInlineValue: <string> | <number> | true | false | null | <list> | <ident>
ArchStmt: category <ident> | chosen <head-token> | reason <string> | rejected-alternatives <list> | consequences <list> | scope { … } | decision <string> | <provenance>
ValRuleStmt: target <ident> | when <qr-predicate> | actor <ident> | effect <val-rule-effect> | on-violation { … } | <provenance>
ValRuleEffect: required | optional | forbidden
ValRuleOnViolationInner: status <number> | error-code <ident>
FbkStmt: target (<ref> | <ident>) | when <fbk-trigger> | default <fbk-value> | <provenance>
FbkTrigger: null-or-absent | absent | null
FbkValue: <string> | <number> | true | false | null | <ident>
FldExpStmt: field (<ref> | <ident>) | via <fld-exp-channel> | in (<ref> | <ident> | <string>) | <provenance>
FldExpChannel: query-select | api-response
UnenfStmt: spec-text <string> | category (<ident> | <string>) | rationale <string> | could-become-enforceable-via <ref> | <provenance>`;
    expect(renderGrammarKeywordReference()).toBe(EXPECTED);
  });
});
