import { describe, it, expect } from 'vitest'
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker'
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index'
import { parseCode } from '../../packages/analyzer/src/parser'

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled)

function check(code: string, filePath = '/test/file.py') {
  const tree = parseCode(code, 'python')
  return checkCodeRules(tree, filePath, code, enabledRules, 'python')
}

function byRule(violations: ReturnType<typeof check>, ruleKey: string) {
  return violations.filter((v) => v.ruleKey === ruleKey)
}

// ---------------------------------------------------------------------------
// database/deterministic/orm-lazy-load-in-loop
// ---------------------------------------------------------------------------

describe('database/deterministic/orm-lazy-load-in-loop', () => {
  it('FP skip: JSONB column attribute access in loop is not lazy loading', () => {
    const code = `
def process_items(items):
    for item in items:
        val = item.metrics.get("cpu_usage")
        data = item.payload.get("size", 0)
        cfg = item.config.get("timeout")
`
    const violations = byRule(check(code), 'database/deterministic/orm-lazy-load-in-loop')
    expect(violations).toHaveLength(0)
  })

  it('TP: real relationship lazy loading in loop', () => {
    const code = `
from sqlalchemy.orm import Session
def get_order_items(orders):
    for order in orders:
        for item in order.items.all():
            results.append(item.name)
`
    const violations = byRule(check(code), 'database/deterministic/orm-lazy-load-in-loop')
    expect(violations.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// database/deterministic/missing-unique-constraint
// ---------------------------------------------------------------------------

describe('database/deterministic/missing-unique-constraint', () => {
  it('FP skip: .first() lookup by primary key (id) is not a uniqueness check', () => {
    const code = `
from sqlalchemy.orm import Session

def get_load(session, load_id):
    if session.query(Load).filter(Load.id == load_id).first():
        session.merge(existing)
`
    const violations = byRule(check(code), 'database/deterministic/missing-unique-constraint')
    expect(violations).toHaveLength(0)
  })

  it('FP skip: .first() lookup by uuid', () => {
    const code = `
from sqlalchemy.orm import Session

def get_entity(session, entity_uuid):
    if session.query(Entity).filter(Entity.uuid == entity_uuid).first():
        session.merge(existing)
`
    const violations = byRule(check(code), 'database/deterministic/missing-unique-constraint')
    expect(violations).toHaveLength(0)
  })

  it('TP: .first() by non-PK column (email) in check-then-act', () => {
    const code = `
from sqlalchemy.orm import Session

def create_user_if_not_exists(session, email):
    if not session.query(User).filter(User.email == email).first():
        new_user = User(email=email)
        session.add(new_user)
`
    const violations = byRule(check(code), 'database/deterministic/missing-unique-constraint')
    expect(violations.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// database/deterministic/missing-migration
// ---------------------------------------------------------------------------

describe('database/deterministic/missing-migration', () => {
  it('FP skip: ALTER TABLE inside Alembic migration file', () => {
    const code = `
def upgrade():
    op.execute("ALTER TABLE users ADD COLUMN age INTEGER")
`
    const violations = byRule(
      check(code, '/app/alembic/versions/001_add_age.py'),
      'database/deterministic/missing-migration',
    )
    expect(violations).toHaveLength(0)
  })

  it('FP skip: ALTER TABLE inside generic migration path', () => {
    const code = `
def upgrade():
    op.execute("ALTER TABLE users ADD COLUMN age INTEGER")
`
    const violations = byRule(
      check(code, '/app/db/migrations/001_add_age.py'),
      'database/deterministic/missing-migration',
    )
    expect(violations).toHaveLength(0)
  })

  it('TP: ALTER TABLE in application code', () => {
    const code = `
def apply_schema_change(cursor):
    cursor.execute("ALTER TABLE users ADD COLUMN age INTEGER")
`
    const violations = byRule(check(code), 'database/deterministic/missing-migration')
    expect(violations.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/eval-usage
// ---------------------------------------------------------------------------

describe('security/deterministic/eval-usage', () => {
  it('FP skip: re.compile() is regex, not code evaluation', () => {
    const code = `
import re
PATTERN = re.compile(r"^\\d{4}-\\d{2}-\\d{2}$")
`
    const violations = byRule(check(code), 'security/deterministic/eval-usage')
    expect(violations).toHaveLength(0)
  })

  it('FP skip: redis.eval() runs Lua, not Python', () => {
    const code = `
def run_script(redis, keys):
    return redis.eval("return redis.call('get', KEYS[1])", 1, *keys)
`
    const violations = byRule(check(code), 'security/deterministic/eval-usage')
    expect(violations).toHaveLength(0)
  })

  it('TP: bare eval() is dangerous', () => {
    const code = `
def dangerous(user_input):
    return eval(user_input)
`
    const violations = byRule(check(code), 'security/deterministic/eval-usage')
    expect(violations.length).toBeGreaterThanOrEqual(1)
  })

  it('TP: bare exec() is dangerous', () => {
    const code = `
def run_code(code_str):
    exec(code_str)
`
    const violations = byRule(check(code), 'security/deterministic/eval-usage')
    expect(violations.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/insecure-cookie
// ---------------------------------------------------------------------------

describe('security/deterministic/insecure-cookie', () => {
  it('FP skip: secure=function_call(request) is accepted', () => {
    const code = `
def set_cookie(response, request, token):
    response.set_cookie("session", token, secure=cookie_secure_flag(request), httponly=True)
`
    const violations = byRule(check(code), 'security/deterministic/insecure-cookie')
    expect(violations).toHaveLength(0)
  })

  it('FP skip: secure=variable is accepted', () => {
    const code = `
def set_cookie(response, token, is_secure):
    response.set_cookie("auth", token, secure=is_secure, httponly=True)
`
    const violations = byRule(check(code), 'security/deterministic/insecure-cookie')
    expect(violations).toHaveLength(0)
  })

  it('TP: secure=False is insecure', () => {
    const code = `
def set_cookie(response, token):
    response.set_cookie("session", token, secure=False, httponly=True)
`
    const violations = byRule(check(code), 'security/deterministic/insecure-cookie')
    expect(violations.length).toBeGreaterThanOrEqual(1)
  })

  it('TP: missing secure flag entirely', () => {
    const code = `
def set_cookie(response, token):
    response.set_cookie("session", token, httponly=True)
`
    const violations = byRule(check(code), 'security/deterministic/insecure-cookie')
    expect(violations.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// database/deterministic/missing-transaction
// ---------------------------------------------------------------------------

describe('database/deterministic/missing-transaction', () => {
  it('FP skip: set.add() and dict[key]=value are not DB writes', () => {
    const code = `
def process_batch(items):
    seen = set()
    result = {}
    for item in items:
        seen.add(item.id)
        result[item.id] = item.name
        seen.add(item.parent_id)
        result[item.parent_id] = item.parent_name
`
    const violations = byRule(check(code), 'database/deterministic/missing-transaction')
    expect(violations).toHaveLength(0)
  })

  it('TP: multiple session.add() calls without transaction', () => {
    const code = `
def transfer(session, from_id, to_id, amount):
    debit = Payment(account_id=from_id, amount=-amount)
    session.add(debit)
    credit = Payment(account_id=to_id, amount=amount)
    session.add(credit)
`
    const violations = byRule(check(code), 'database/deterministic/missing-transaction')
    expect(violations.length).toBeGreaterThanOrEqual(1)
  })
})
