import { describe, it, expect } from 'vitest'
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker'
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index'
import { parseCode } from '../../packages/analyzer/src/parser'

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled)

function check(code: string) {
  const tree = parseCode(code, 'csharp')
  return checkCodeRules(tree, '/app/src/File.cs', code, enabledRules, 'csharp')
}

// ---------------------------------------------------------------------------
// architecture/deterministic/duplicate-import
// ---------------------------------------------------------------------------

describe('architecture/deterministic/duplicate-import (C#)', () => {
  it('detects a duplicated using directive', () => {
    const violations = check(`using System.Text.Json;
using System.Net.Http;
using System.Text.Json;

namespace App;
public class Worker { }
`)
    const matches = violations.filter((v) => v.ruleKey === 'architecture/deterministic/duplicate-import')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag distinct usings or different forms of the same target', () => {
    const violations = check(`using System.Text.Json;
using static System.Math;
using Json = System.Text.Json;

namespace App;
public class Worker { }
`)
    const matches = violations.filter((v) => v.ruleKey === 'architecture/deterministic/duplicate-import')
    expect(matches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/declarations-in-global-scope
// ---------------------------------------------------------------------------

describe('architecture/deterministic/declarations-in-global-scope (C#)', () => {
  it('detects a mutable static field', () => {
    const violations = check(`namespace App;
public class Cache
{
    public static int RequestCount = 0;
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'architecture/deterministic/declarations-in-global-scope')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag readonly/const statics or instance fields', () => {
    const violations = check(`namespace App;
public class Config
{
    public const int MaxRetries = 3;
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);
    private int _instanceCounter = 0;
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'architecture/deterministic/declarations-in-global-scope')
    expect(matches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/unused-import
// ---------------------------------------------------------------------------

describe('architecture/deterministic/unused-import (C#)', () => {
  it('detects an unused alias using', () => {
    const violations = check(`using Fmt = System.Text.Json.JsonSerializer;

namespace App;
public class Worker
{
    public void Run() { Console.WriteLine("hi"); }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'architecture/deterministic/unused-import')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a used alias or plain namespace usings', () => {
    const violations = check(`using Fmt = System.Text.Json.JsonSerializer;
using System.Collections.Generic;

namespace App;
public class Worker
{
    public string Run(object o) { return Fmt.Serialize(o); }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'architecture/deterministic/unused-import')
    expect(matches).toHaveLength(0)
  })
})
