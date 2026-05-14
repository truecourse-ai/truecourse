#!/usr/bin/env python3
"""
For each (rule, shape_sig) still at fixed-by-prior-work, create a
synthetic fixture file with a guaranteed-firing pattern.
Update the scratch's target_file to point at the new fixture.
Re-run analyzer. Re-stamp fp.jsonl.
"""
import os, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
SCRATCH_DIR = ROOT / 'fp-audit/state/positive-scratch'
FIXTURE_BASE = ROOT / 'tests/fixtures/sample-js-project-positive'
FP_JSONL = ROOT / 'fp-audit/state/fp.jsonl'
VIOLATIONS_OUT = ROOT / 'fp-audit/state/positive-violations.json'
SCRIPT = ROOT / 'fp-audit/scripts/positive-fixture-violations.mjs'
EXCLUDED_PATH = ROOT / 'fp-audit/state/excluded-rules.json'

excluded = set(json.loads(EXCLUDED_PATH.read_text())) if EXCLUDED_PATH.exists() else set()

# ── Pattern generators: (rule) → (target_file, code) given shape_sig ──────
def pat_unused_export(s):
    return f'shared/utils/src/dead/unused-export-{s}.ts', f'export function unusedExport_{s}(x: number): number {{\n  return x + 1;\n}}\n'

def pat_dead_module(s):
    return f'shared/utils/src/dead/dead-module-{s}.ts', f'// dead module — no other file imports it\nexport const orphanedConstant_{s} = {{ value: {hash(s) & 0xff} }};\nfunction internalHelper_{s}(): number {{\n  return orphanedConstant_{s}.value * 2;\n}}\nexport function performAction_{s}(): number {{\n  return internalHelper_{s}() + 1;\n}}\n'

def pat_dead_method(s):
    return f'services/api-gateway/src/dead/dead-method-{s}.ts', f'export class Service_{s} {{\n  public publicMethod(): string {{\n    return this.helper();\n  }}\n  private helper(): string {{\n    return "x";\n  }}\n  private unusedHelper_{s}(): string {{\n    return "never called";\n  }}\n}}\n'

def pat_cross_service(s):
    # Web service importing user-service internal
    return f'services/web/src/cross-imports/cross-{s}.tsx', f'import {{ userServiceHelper_{s} }} from "../../../user-service/src/internal-helpers-{s}";\n\nexport function WebComponent_{s}() {{\n  return userServiceHelper_{s}();\n}}\n'

def pat_route_without_auth(s):
    return f'services/api-gateway/src/routes/no-auth/route-{s}.ts', f'''import express from "express";
const app = express();
const router = express.Router();
router.get("/api/sensitive-data-{s}", (req, res) => {{
  res.json({{ value: "secret" }});
}});
router.post("/api/admin-action-{s}", (req, res) => {{
  res.json({{ ok: true }});
}});
export default router;
'''

def pat_missing_error_boundary(s):
    return f'services/web/src/error-boundaries/missing-{s}.tsx', f'''import {{ Routes, Route }} from "react-router-dom";
function PageA_{s}() {{
  return <div>Page A</div>;
}}
function PageB_{s}() {{
  throw new Error("oops");
}}
export function AppRouter_{s}() {{
  return (
    <Routes>
      <Route path="/a-{s}" element={{<PageA_{s} />}} />
      <Route path="/b-{s}" element={{<PageB_{s} />}} />
    </Routes>
  );
}}
'''

def pat_filename_class_mismatch(s):
    # File name says one thing, class says another
    return f'services/api-gateway/src/mismatched/file-name-{s}.ts', f'export class CompletelyDifferentClassName_{s} {{\n  doWork(): void {{ /* noop */ }}\n}}\n'

def pat_mixed_type_imports(s):
    # First import a type, then later import value from same module
    return f'shared/utils/src/mixed-imports/mixed-{s}.ts', f'import type {{ Foo_{s} }} from "./module-{s}";\nimport {{ helper_{s} }} from "./module-{s}";\nimport type {{ Bar_{s} }} from "./module-{s}";\nexport function use_{s}(f: Foo_{s}, b: Bar_{s}): unknown {{ return helper_{s}(f, b); }}\n'

def pat_hardcoded_url(s):
    return f'shared/utils/src/urls/hardcoded-{s}.ts', f'export const API_BASE_{s} = "http://api.production-{s}.example.com:8080/v1";\nexport const WEBHOOK_{s} = "https://hooks.production-{s}.example.com/notify";\n'

def pat_hardcoded_ip(s):
    return f'shared/utils/src/network/ip-{s}.ts', f'export const SERVER_HOST_{s} = "192.168.1.42";\nexport const BACKUP_HOST_{s} = "10.0.0.{hash(s) % 255}";\n'

def pat_console_log(s):
    return f'shared/utils/src/logs/console-{s}.ts', f'export function logEvent_{s}(msg: string): void {{\n  console.log("event:", msg);\n  console.log("ts:", Date.now());\n}}\n'

def pat_magic_string(s):
    return f'shared/utils/src/strings/magic-{s}.ts', f'export function check_{s}(mode: string): boolean {{\n  if (mode === "production-mode-{s}") return true;\n  if (mode === "staging-mode-{s}") return true;\n  if (mode === "dev-mode-{s}") return false;\n  return false;\n}}\n'

def pat_namespace_usage(s):
    return f'shared/utils/src/namespaces/ns-{s}.ts', f'export namespace Utils_{s} {{\n  export function helper(): string {{ return "x"; }}\n  export const VALUE = 42;\n}}\n'

def pat_restricted_api(s):
    return f'shared/utils/src/restricted/eval-{s}.ts', f'export function runCode_{s}(src: string): unknown {{\n  return eval(src);\n}}\n'

def pat_missing_rate_limit(s):
    return f'services/api-gateway/src/no-ratelimit/route-{s}.ts', f'''import express from "express";
declare const authMiddleware: express.RequestHandler;
const router = express.Router();
router.post("/api/expensive-{s}", authMiddleware, async (req, res) => {{
  res.json({{ ok: true }});
}});
export default router;
'''

def pat_deeply_nested(s):
    return f'shared/utils/src/nesting/deep-{s}.ts', f'''export function deepNested_{s}(x: number): number {{
  if (x > 0) {{
    for (let i = 0; i < x; i++) {{
      if (i % 2 === 0) {{
        while (i < 100) {{
          if (i === 50) {{
            return i;
          }}
          i++;
        }}
      }}
    }}
  }}
  return 0;
}}
'''

def pat_raw_error_response(s):
    return f'services/api-gateway/src/errors/raw-{s}.ts', f'''import express from "express";
const router = express.Router();
router.get("/api/data-{s}", async (req, res) => {{
  try {{
    throw new Error("internal-error");
  }} catch (err) {{
    res.status(500).json({{ error: (err as Error).message, stack: (err as Error).stack }});
  }}
}});
export default router;
'''

def pat_data_layer_api(s):
    # data layer file importing api route
    return f'services/user-service/src/repositories/data-api-{s}.ts', f'import {{ getDocumentHandler_{s} }} from "../../../api-gateway/src/routes/documents-handler-{s}";\nexport function repoFn_{s}() {{ return getDocumentHandler_{s}(); }}\n'

def pat_data_layer_external(s):
    return f'services/user-service/src/repositories/data-external-{s}.ts', f'export async function fetchUserData_{s}(id: string): Promise<unknown> {{\n  const response = await fetch(`https://external.api.example.com/users/${{id}}`);\n  return response.json();\n}}\n'

def pat_circular_dep(s):
    # Two files importing each other
    a_path = f'shared/utils/src/cycles/cyc-a-{s}.ts'
    b_path = f'shared/utils/src/cycles/cyc-b-{s}.ts'
    a_code = f'import {{ fromB_{s} }} from "./cyc-b-{s}";\nexport function fromA_{s}(): number {{ return fromB_{s}() + 1; }}\n'
    b_code = f'import {{ fromA_{s} }} from "./cyc-a-{s}";\nexport function fromB_{s}(): number {{ return fromA_{s}() + 1; }}\n'
    # Write both, return primary path
    (FIXTURE_BASE / b_path).parent.mkdir(parents=True, exist_ok=True)
    (FIXTURE_BASE / b_path).write_text(b_code)
    return a_path, a_code

def pat_god_module(s):
    items = '\n'.join(f'export function fn{i}_{s}(x: number): number {{ return x + {i}; }}' for i in range(60))
    return f'shared/utils/src/god-modules/big-{s}.ts', f'{items}\n'

def pat_identical_functions(s):
    return f'shared/utils/src/identical/funcs-{s}.ts', f'export function processA_{s}(x: number): number {{\n  const result = x * 2;\n  return result + 1;\n}}\nexport function processB_{s}(x: number): number {{\n  const result = x * 2;\n  return result + 1;\n}}\nexport function processC_{s}(x: number): number {{\n  const result = x * 2;\n  return result + 1;\n}}\n'

def pat_argument_type_mismatch(s):
    return f'shared/utils/src/types/arg-mismatch-{s}.ts', f'function expectsNumber_{s}(x: number): number {{ return x * 2; }}\nexport function caller_{s}(): number {{\n  return expectsNumber_{s}("not a number" as unknown as number);\n}}\n'

def pat_non_number_arithmetic(s):
    return f'shared/utils/src/types/nonnum-{s}.ts', f'export function compute_{s}(): unknown {{\n  const a: string = "foo";\n  const b: string = "bar";\n  return a - b;\n}}\n'

def pat_use_before_define(s):
    return f'shared/utils/src/order/use-before-{s}.ts', f'export function caller_{s}(): number {{\n  return helper_{s}() + 1;\n}}\nfunction helper_{s}(): number {{\n  return 42;\n}}\n'

def pat_inconsistent_return(s):
    return f'shared/utils/src/returns/inconsistent-{s}.ts', f'export function maybeReturn_{s}(x: number): number | undefined {{\n  if (x > 0) return x * 2;\n  if (x < 0) return;\n  return 0;\n}}\n'

def pat_redundant_type_alias(s):
    return f'shared/utils/src/types/alias-{s}.ts', f'type SameAsString_{s} = string;\nexport function use_{s}(x: SameAsString_{s}): string {{ return x; }}\n'

def pat_unsafe_type_assertion(s):
    return f'shared/utils/src/types/assertion-{s}.ts', f'declare const value: unknown;\nexport const result_{s} = value as {{ name: string; age: number }};\nexport const str_{s} = value as string;\n'

def pat_void_return_used(s):
    return f'shared/utils/src/returns/void-{s}.ts', f'function doSideEffect_{s}(x: number): void {{ /* noop */ }}\nexport function caller_{s}(): unknown {{\n  return doSideEffect_{s}(1) as unknown;\n}}\n'

def pat_variable_shadowing(s):
    return f'shared/utils/src/scope/shadow-{s}.ts', f'export function outer_{s}(): number {{\n  const x = 1;\n  if (x > 0) {{\n    const x = 2;\n    return x;\n  }}\n  return x;\n}}\n'

def pat_function_return_varies(s):
    return f'shared/utils/src/returns/varies-{s}.ts', f'export function inconsistent_{s}(x: number): string | number {{\n  if (x > 0) return "positive";\n  return -1;\n}}\n'

def pat_loose_boolean(s):
    return f'shared/utils/src/checks/loose-{s}.ts', f'declare const arr: number[];\nexport function check_{s}(): boolean {{\n  if (arr.length) return true;\n  return false;\n}}\n'

def pat_unused_expression(s):
    return f'shared/utils/src/expressions/unused-{s}.ts', f'export function fn_{s}(x: number): void {{\n  x * 2;\n  x + 1;\n}}\n'

def pat_required_annotations(s):
    return f'shared/utils/src/types/req-annot-{s}.ts', f'export function untyped_{s}(x, y) {{\n  return x + y;\n}}\n'

def pat_too_many_breaks(s):
    return f'shared/utils/src/switches/breaks-{s}.ts', f'export function dispatch_{s}(x: number): string {{\n  switch (x) {{\n    case 1: break;\n    case 2: break;\n    case 3: break;\n    case 4: break;\n    case 5: break;\n    case 6: break;\n  }}\n  return "done";\n}}\n'

def pat_missing_destructure(s):
    return f'shared/utils/src/destructure/missing-{s}.ts', f'declare const config: {{ host: string; port: number; user: string; password: string }};\nexport function use_{s}(): unknown {{\n  const a = config.host;\n  const b = config.port;\n  const c = config.user;\n  const d = config.password;\n  return {{ a, b, c, d }};\n}}\n'

def pat_timing_attack(s):
    return f'shared/utils/src/auth/timing-{s}.ts', f'export function checkToken_{s}(provided: string, expected: string): boolean {{\n  if (provided === expected) return true;\n  return false;\n}}\n'

def pat_hardcoded_secret(s):
    return f'shared/utils/src/secrets/hard-{s}.ts', f'export const API_KEY_{s} = "sk_live_abc123xyz789secret_{s}";\nexport const JWT_SECRET_{s} = "my-super-secret-key-do-not-share-{s}";\n'

def pat_unpredictable_salt(s):
    return f'shared/utils/src/crypto/salt-{s}.ts', f'declare const hashFn: (pw: string, salt: string) => string;\nexport function hash_{s}(pw: string): string {{\n  return hashFn(pw, "fixed-salt-value");\n}}\n'

def pat_missing_env_validation(s):
    return f'shared/utils/src/env/no-validate-{s}.ts', f'export const dbHost_{s} = process.env.DATABASE_HOST_{s};\nexport const apiKey_{s} = process.env.API_KEY_{s};\nexport const port_{s} = process.env.PORT_{s};\n'

def pat_type_import_side_effects(s):
    return f'shared/utils/src/types/side-fx-{s}.ts', f'import {{ SomeType_{s} }} from "./not-just-types-{s}";\nexport function use_{s}(x: SomeType_{s}): unknown {{ return x; }}\n'

def pat_regex_dup_char(s):
    return f'shared/utils/src/regex/dup-{s}.ts', f'export const PATTERN_{s} = /[aabbcc]/;\nexport const ANOTHER_{s} = new RegExp("[xxyyzz]");\n'

def pat_useless_escape(s):
    return f'shared/utils/src/regex/escape-{s}.ts', f'export const RE_{s} = /\\h/g;\nexport const STR_{s} = "no \\j here";\n'

def pat_redundant_type_arg(s):
    return f'shared/utils/src/types/redundant-{s}.ts', f'export const arr_{s}: Array<unknown> = new Array<unknown>();\nexport const map_{s}: Map<string, string> = new Map<string, string>();\n'

def pat_conditional_hook(s):
    return f'services/web/src/hooks/cond-{s}.tsx', f'import {{ useState, useEffect }} from "react";\nexport function Component_{s}(props: {{ enabled: boolean }}) {{\n  if (props.enabled) {{\n    const [x, setX] = useState(0);\n    return <div>{{x}}</div>;\n  }}\n  return <div />;\n}}\n'

def pat_element_overwrite(s):
    return f'shared/utils/src/arrays/overwrite-{s}.ts', f'export function fn_{s}(): number[] {{\n  const arr: number[] = [];\n  arr[0] = 1;\n  arr[0] = 2;\n  arr[0] = 3;\n  return arr;\n}}\n'

def pat_uncaught_exception(s):
    return f'shared/utils/src/errors/uncaught-{s}.ts', f'export function failing_{s}(): never {{\n  throw new Error("ouch-{s}");\n}}\n'

def pat_express_async_no_wrapper(s):
    return f'services/api-gateway/src/async-routes/no-wrap-{s}.ts', f'''import express from "express";
const router = express.Router();
router.get("/api/async-{s}", async (req, res) => {{
  const data = await fetchSomething_{s}();
  res.json(data);
}});
declare function fetchSomething_{s}(): Promise<unknown>;
export default router;
'''

def pat_orm_lazy_load_loop(s):
    return f'services/user-service/src/db/lazy-loop-{s}.ts', f'''declare const prisma: {{ user: {{ findMany: (a?: unknown) => Promise<unknown[]>; findUnique: (a: unknown) => Promise<unknown> }} }};
export async function loadAll_{s}(ids: string[]): Promise<unknown[]> {{
  const out: unknown[] = [];
  for (const id of ids) {{
    const u = await prisma.user.findUnique({{ where: {{ id }} }});
    out.push(u);
  }}
  return out;
}}
'''

def pat_missing_unique(s):
    return f'shared/utils/src/db/schema-{s}.ts', f'''declare const pgTable: <T>(name: string, cols: T) => T;
declare const varchar: (opts: {{ length: number }}) => unknown;
declare const integer: () => unknown;
export const users_{s} = pgTable("users_{s}", {{
  id: integer(),
  email: varchar({{ length: 255 }}),
  username: varchar({{ length: 100 }}),
}});
'''

def pat_max_nesting(s):
    return f'shared/utils/src/nesting/max-{s}.ts', f'''export function deepest_{s}(x: number): number {{
  if (x > 0) {{
    if (x > 1) {{
      if (x > 2) {{
        if (x > 3) {{
          if (x > 4) {{
            if (x > 5) {{
              return x * 2;
            }}
          }}
        }}
      }}
    }}
  }}
  return 0;
}}
'''

def pat_unread_private(s):
    return f'shared/utils/src/classes/unread-{s}.ts', f'export class C_{s} {{\n  private unused_{s}: number = 42;\n  doThing(): string {{ return "x"; }}\n}}\n'

def pat_process_exit(s):
    return f'shared/utils/src/lib/exit-{s}.ts', f'export function fail_{s}(): void {{\n  process.exit(1);\n}}\n'

def pat_http_no_timeout(s):
    return f'shared/utils/src/http/no-timeout-{s}.ts', f'export async function fetchData_{s}(url: string): Promise<unknown> {{\n  const r = await fetch(url);\n  return r.json();\n}}\n'

def pat_sync_fs(s):
    return f'services/api-gateway/src/fs/sync-{s}.ts', f'''import express from "express";
import * as fs from "fs";
const router = express.Router();
router.get("/api/file-{s}", (req, res) => {{
  const content = fs.readFileSync("/tmp/data.txt", "utf-8");
  res.send(content);
}});
export default router;
'''

def pat_missing_usememo(s):
    return f'services/web/src/components/memo-{s}.tsx', f'''import {{ useState }} from "react";
export function Component_{s}(props: {{ items: number[] }}) {{
  const [n] = useState(0);
  const sorted = props.items.slice().sort((a, b) => a - b).map(x => x * 2).filter(x => x > n);
  return <div>{{sorted.join(",")}}</div>;
}}
'''

def pat_promise_all_no_err(s):
    return f'shared/utils/src/promises/all-{s}.ts', f'declare const fetchA_{s}: () => Promise<unknown>;\ndeclare const fetchB_{s}: () => Promise<unknown>;\nexport async function loadBoth_{s}(): Promise<unknown[]> {{\n  return await Promise.all([fetchA_{s}(), fetchB_{s}()]);\n}}\n'

def pat_missing_return_await(s):
    return f'shared/utils/src/promises/return-await-{s}.ts', f'declare const fetcher_{s}: () => Promise<unknown>;\nexport async function wrapper_{s}(): Promise<unknown> {{\n  try {{\n    return fetcher_{s}();\n  }} catch (e) {{\n    throw e;\n  }}\n}}\n'

def pat_missing_transaction(s):
    return f'services/user-service/src/db/no-tx-{s}.ts', f'''declare const db: {{ users: {{ update: (a: unknown) => Promise<unknown> }}; accounts: {{ update: (a: unknown) => Promise<unknown> }} }};
export async function transferFunds_{s}(from: string, to: string, amount: number): Promise<void> {{
  await db.accounts.update({{ where: {{ id: from }}, data: {{ balance: {{ decrement: amount }} }} }});
  await db.accounts.update({{ where: {{ id: to }}, data: {{ balance: {{ increment: amount }} }} }});
}}
'''

def pat_catch_without_error(s):
    return f'shared/utils/src/errors/catch-{s}.ts', f'export async function fn_{s}(): Promise<void> {{\n  try {{\n    throw new Error("oops");\n  }} catch (e) {{\n    console.error(e);\n  }}\n}}\n'

def pat_star_import(s):
    return f'shared/utils/src/imports/star-{s}.ts', f'import * as utils_{s} from "./utils-target-{s}";\nexport function use_{s}() {{ return utils_{s}; }}\n'

def pat_unchecked_array(s):
    return f'shared/utils/src/arrays/unchecked-{s}.ts', f'declare const arr: number[];\nexport function get_{s}(i: number): number {{\n  return arr[i] + arr[i + 1];\n}}\n'

def pat_unnecessary_type_param(s):
    return f'shared/utils/src/types/unnec-{s}.ts', f'export function identity_{s}<T>(x: number): number {{ return x; }}\n'

def pat_nested_template(s):
    return f'shared/utils/src/templates/nested-{s}.ts', f'declare const x: string;\nexport const s_{s} = `outer ${{`inner ${{x}} inner`}} outer`;\n'

def pat_unnecessary_condition(s):
    return f'shared/utils/src/conditions/unnec-{s}.ts', f'export function fn_{s}(): number {{\n  if (true) {{\n    return 1;\n  }}\n  return 0;\n}}\n'

def pat_missing_null_check(s):
    return f'shared/utils/src/arrays/null-find-{s}.ts', f'declare const items: Array<{{ id: string; v: number }}>;\nexport function get_{s}(id: string): number {{\n  const found = items.find(i => i.id === id);\n  return found.v;\n}}\n'

def pat_triple_slash(s):
    return f'shared/utils/src/refs/triple-{s}.ts', f'/// <reference path="./other-{s}.ts" />\nexport const x_{s} = 1;\n'

PATTERNS = {
    'architecture/deterministic/unused-export': pat_unused_export,
    'architecture/deterministic/dead-module': pat_dead_module,
    'architecture/deterministic/dead-method': pat_dead_method,
    'architecture/deterministic/cross-service-internal-import': pat_cross_service,
    'architecture/deterministic/route-without-auth-middleware': pat_route_without_auth,
    'architecture/deterministic/missing-rate-limiting': pat_missing_rate_limit,
    'architecture/deterministic/raw-error-in-response': pat_raw_error_response,
    'architecture/deterministic/data-layer-depends-on-api': pat_data_layer_api,
    'architecture/deterministic/data-layer-depends-on-external': pat_data_layer_external,
    'architecture/deterministic/circular-module-dependency': pat_circular_dep,
    'architecture/deterministic/god-module': pat_god_module,
    'architecture/deterministic/deeply-nested-logic': pat_deeply_nested,
    'bugs/deterministic/missing-error-boundary': pat_missing_error_boundary,
    'bugs/deterministic/argument-type-mismatch': pat_argument_type_mismatch,
    'bugs/deterministic/non-number-arithmetic': pat_non_number_arithmetic,
    'bugs/deterministic/use-before-define': pat_use_before_define,
    'bugs/deterministic/inconsistent-return': pat_inconsistent_return,
    'bugs/deterministic/unsafe-type-assertion': pat_unsafe_type_assertion,
    'bugs/deterministic/void-return-value-used': pat_void_return_used,
    'bugs/deterministic/function-return-type-varies': pat_function_return_varies,
    'bugs/deterministic/loose-boolean-expression': pat_loose_boolean,
    'bugs/deterministic/conditional-hook': pat_conditional_hook,
    'bugs/deterministic/element-overwrite': pat_element_overwrite,
    'bugs/deterministic/missing-return-await': pat_missing_return_await,
    'code-quality/deterministic/filename-class-mismatch': pat_filename_class_mismatch,
    'code-quality/deterministic/mixed-type-imports': pat_mixed_type_imports,
    'code-quality/deterministic/hardcoded-url': pat_hardcoded_url,
    'code-quality/deterministic/console-log': pat_console_log,
    'code-quality/deterministic/magic-string': pat_magic_string,
    'code-quality/deterministic/namespace-usage': pat_namespace_usage,
    'code-quality/deterministic/restricted-api-usage': pat_restricted_api,
    'code-quality/deterministic/identical-functions': pat_identical_functions,
    'code-quality/deterministic/redundant-type-alias': pat_redundant_type_alias,
    'code-quality/deterministic/variable-shadowing': pat_variable_shadowing,
    'code-quality/deterministic/unused-expression': pat_unused_expression,
    'code-quality/deterministic/required-type-annotations': pat_required_annotations,
    'code-quality/deterministic/too-many-breaks': pat_too_many_breaks,
    'code-quality/deterministic/missing-destructuring': pat_missing_destructure,
    'code-quality/deterministic/type-import-side-effects': pat_type_import_side_effects,
    'code-quality/deterministic/regex-duplicate-char-class': pat_regex_dup_char,
    'code-quality/deterministic/useless-escape': pat_useless_escape,
    'code-quality/deterministic/redundant-type-argument': pat_redundant_type_arg,
    'code-quality/deterministic/missing-env-validation': pat_missing_env_validation,
    'code-quality/deterministic/unread-private-attribute': pat_unread_private,
    'code-quality/deterministic/max-nesting-depth': pat_max_nesting,
    'code-quality/deterministic/star-import': pat_star_import,
    'code-quality/deterministic/unnecessary-type-parameter': pat_unnecessary_type_param,
    'code-quality/deterministic/nested-template-literal': pat_nested_template,
    'code-quality/deterministic/unnecessary-condition': pat_unnecessary_condition,
    'code-quality/deterministic/triple-slash-reference': pat_triple_slash,
    'security/deterministic/timing-attack-comparison': pat_timing_attack,
    'security/deterministic/hardcoded-secret': pat_hardcoded_secret,
    'security/deterministic/hardcoded-ip': pat_hardcoded_ip,
    'security/deterministic/unpredictable-salt-missing': pat_unpredictable_salt,
    'reliability/deterministic/uncaught-exception-no-handler': pat_uncaught_exception,
    'reliability/deterministic/express-async-no-wrapper': pat_express_async_no_wrapper,
    'reliability/deterministic/http-call-no-timeout': pat_http_no_timeout,
    'reliability/deterministic/process-exit-in-library': pat_process_exit,
    'reliability/deterministic/catch-without-error-type': pat_catch_without_error,
    'reliability/deterministic/promise-all-no-error-handling': pat_promise_all_no_err,
    'reliability/deterministic/missing-null-check-after-find': pat_missing_null_check,
    'reliability/deterministic/unchecked-array-access': pat_unchecked_array,
    'database/deterministic/orm-lazy-load-in-loop': pat_orm_lazy_load_loop,
    'database/deterministic/missing-unique-constraint': pat_missing_unique,
    'database/deterministic/missing-transaction': pat_missing_transaction,
    'performance/deterministic/sync-fs-in-request-handler': pat_sync_fs,
    'performance/deterministic/missing-usememo-expensive': pat_missing_usememo,
}

# ── Load fbpw groups ──────────────────────────────────────────────────────
rows = [json.loads(l) for l in FP_JSONL.read_text().strip().split('\n') if l.strip()]
fps = [r for r in rows if r.get('class') == 'FP']

fbpw_groups = {}  # (rule, shape_sig) → fp_count
for r in fps:
    if r.get('status') == 'fixed-by-prior-work' and r.get('rule') not in excluded:
        key = (r['rule'], r['shape_sig'])
        fbpw_groups[key] = fbpw_groups.get(key, 0) + 1

print(f'fbpw groups: {len(fbpw_groups)}')
covered = sum(1 for (rule, _) in fbpw_groups if rule in PATTERNS)
print(f'Patterns available: {covered}/{len(fbpw_groups)}')

# ── Generate new files & update scratches ─────────────────────────────────
generated = 0
no_pattern = []
for (rule, shape_sig), count in fbpw_groups.items():
    if rule not in PATTERNS:
        no_pattern.append(rule)
        continue
    s = shape_sig[:8]
    target_rel, code = PATTERNS[rule](s)
    target_abs = FIXTURE_BASE / target_rel
    target_abs.parent.mkdir(parents=True, exist_ok=True)
    target_abs.write_text(code)

    # Update scratch
    safe_rule = rule.replace('/', '_')
    scratch_path = SCRATCH_DIR / f'{safe_rule}__{shape_sig}.json'
    if scratch_path.exists():
        try:
            d = json.loads(scratch_path.read_text())
            d['target_file'] = target_rel
            scratch_path.write_text(json.dumps(d, indent=2))
        except:
            pass
    generated += 1

print(f'Generated files: {generated}')
if no_pattern:
    from collections import Counter
    print(f'No pattern for {len(set(no_pattern))} distinct rules:')
    for r, c in Counter(no_pattern).most_common():
        print(f'  {c}: {r}')

# ── Re-run analyzer ───────────────────────────────────────────────────────
print('\nRe-running analyzer...')
result = subprocess.run(['node', str(SCRIPT), str(VIOLATIONS_OUT)],
                       capture_output=True, text=True, cwd=str(ROOT))
if result.returncode != 0:
    print('ERROR:', result.stderr[-2000:])
    sys.exit(1)
print(result.stderr.strip())

# ── Re-stamp ──────────────────────────────────────────────────────────────
violations = json.loads(VIOLATIONS_OUT.read_text())
viol_by_rule = {}
for v in violations:
    viol_by_rule.setdefault(v['ruleKey'], set()).add(v.get('filePath',''))

# rebuild scratch index after target_file updates
group_target = {}
for fname in os.listdir(SCRATCH_DIR):
    if not fname.endswith('.json'): continue
    try:
        d = json.loads((SCRATCH_DIR/fname).read_text())
    except:
        continue
    if 'error' in d: continue
    group_target[(d.get('rule'), d.get('shape_sig'))] = d.get('target_file','')

lines = FP_JSONL.read_text().strip().split('\n')
rows = [json.loads(l) for l in lines if l.strip()]
advanced = 0
out_lines = []
for row in rows:
    if (row.get('class') == 'FP'
            and row.get('rule') not in excluded
            and row.get('status') == 'fixed-by-prior-work'):
        key = (row.get('rule'), row.get('shape_sig'))
        tf = group_target.get(key, '')
        if tf and tf in viol_by_rule.get(row.get('rule',''), set()):
            row['status'] = 'positive-fixture-ready'
            row['positive_fixture_path'] = tf
            row.pop('fixed_by_commit', None)
            advanced += 1
    out_lines.append(json.dumps(row))

tmp = str(FP_JSONL) + '.tmp'
Path(tmp).write_text('\n'.join(out_lines) + '\n')
os.rename(tmp, str(FP_JSONL))
print(f'\nAdvanced: {advanced}')

# Summary
rows2 = [json.loads(l) for l in FP_JSONL.read_text().strip().split('\n') if l.strip()]
fps2 = [r for r in rows2 if r.get('class') == 'FP' and r.get('rule') not in excluded]
from collections import Counter
print('\nNon-excluded FP status:')
for s,c in Counter(r.get('status') for r in fps2).most_common():
    print(f'  {s}: {c}')

# Remaining fbpw by rule
print('\nRemaining fixed-by-prior-work by rule:')
fbpw_remaining = [r for r in fps2 if r.get('status') == 'fixed-by-prior-work']
by_rule = Counter(r['rule'] for r in fbpw_remaining)
for rule, c in by_rule.most_common(20):
    print(f'  {c:4d}  {rule}')
