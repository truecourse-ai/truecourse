import { describe, it, expect } from 'vitest';
import { parseCode } from '../../packages/analyzer/src/parser';
import {
  extractPythonFunctions,
  extractPythonClasses,
  extractPythonImports,
  extractPythonExports,
} from '../../packages/analyzer/src/extractors/languages/python';

describe('extractPythonFunctions', () => {
  it('extracts a simple function', () => {
    const code = 'def greet(name: str) -> str:\n    return f"Hello {name}"';
    const tree = parseCode(code, 'python');
    const functions = extractPythonFunctions(tree, 'test.py');
    expect(functions).toHaveLength(1);
    expect(functions[0].name).toBe('greet');
    expect(functions[0].params).toHaveLength(1);
    expect(functions[0].params[0].name).toBe('name');
    expect(functions[0].params[0].type).toBe('str');
    expect(functions[0].returnType).toBe('str');
    expect(functions[0].isAsync).toBe(false);
    expect(functions[0].isExported).toBe(true);
  });

  it('extracts async functions', () => {
    const code = 'async def fetch_data(url: str) -> dict:\n    pass';
    const tree = parseCode(code, 'python');
    const functions = extractPythonFunctions(tree, 'test.py');
    expect(functions).toHaveLength(1);
    expect(functions[0].name).toBe('fetch_data');
    expect(functions[0].isAsync).toBe(true);
  });

  it('marks _private functions as not exported', () => {
    const code = 'def _helper():\n    pass\n\ndef public_func():\n    pass';
    const tree = parseCode(code, 'python');
    const functions = extractPythonFunctions(tree, 'test.py');
    expect(functions).toHaveLength(2);
    const helper = functions.find((f) => f.name === '_helper');
    const pub = functions.find((f) => f.name === 'public_func');
    expect(helper?.isExported).toBe(false);
    expect(pub?.isExported).toBe(true);
  });

  it('skips self and cls parameters', () => {
    // Top-level function with self param (unusual but valid)
    const code = 'class Foo:\n    def bar(self, x: int, y: str):\n        pass';
    const tree = parseCode(code, 'python');
    const classes = extractPythonClasses(tree, 'test.py');
    const method = classes[0].methods[0];
    expect(method.params).toHaveLength(2);
    expect(method.params[0].name).toBe('x');
    expect(method.params[1].name).toBe('y');
  });

  it('handles default parameters', () => {
    const code = 'def foo(x: int = 5, y="hello"):\n    pass';
    const tree = parseCode(code, 'python');
    const functions = extractPythonFunctions(tree, 'test.py');
    expect(functions[0].params).toHaveLength(2);
    expect(functions[0].params[0].defaultValue).toBe('5');
    expect(functions[0].params[1].defaultValue).toBe('"hello"');
  });

  it('does not extract class methods as top-level functions', () => {
    const code = 'class Svc:\n    def do_thing(self):\n        pass\n\ndef top_level():\n    pass';
    const tree = parseCode(code, 'python');
    const functions = extractPythonFunctions(tree, 'test.py');
    expect(functions).toHaveLength(1);
    expect(functions[0].name).toBe('top_level');
  });
});

describe('extractPythonClasses', () => {
  it('extracts a class with methods and superclass', () => {
    const code = `class UserService(BaseService):
    def get_all(self) -> list:
        return []

    def get_by_id(self, user_id: str):
        pass`;
    const tree = parseCode(code, 'python');
    const classes = extractPythonClasses(tree, 'test.py');
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('UserService');
    expect(classes[0].superClass).toBe('BaseService');
    expect(classes[0].methods).toHaveLength(2);
    expect(classes[0].methods[0].name).toBe('get_all');
    expect(classes[0].methods[1].name).toBe('get_by_id');
  });

  it('extracts class properties', () => {
    const code = `class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True)
    name = Column(String)`;
    const tree = parseCode(code, 'python');
    const classes = extractPythonClasses(tree, 'test.py');
    expect(classes[0].properties.length).toBeGreaterThanOrEqual(2);
    const names = classes[0].properties.map((p) => p.name);
    expect(names).toContain('__tablename__');
    expect(names).toContain('id');
    expect(names).toContain('name');
  });
});

describe('extractPythonImports', () => {
  it('extracts from...import statements', () => {
    const code = 'from flask import Flask, Blueprint';
    const tree = parseCode(code, 'python');
    const imports = extractPythonImports(tree, 'test.py');
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('flask');
    expect(imports[0].specifiers.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts bare import statements', () => {
    const code = 'import os';
    const tree = parseCode(code, 'python');
    const imports = extractPythonImports(tree, 'test.py');
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('os');
  });

  it('extracts relative imports', () => {
    const code = 'from .models import User\nfrom ..utils import helper';
    const tree = parseCode(code, 'python');
    const imports = extractPythonImports(tree, 'test.py');
    expect(imports).toHaveLength(2);
    expect(imports[0].source).toMatch(/^\..*models/);
    expect(imports[1].source).toMatch(/^\.\..*utils/);
  });

  it('extracts dotted absolute imports', () => {
    const code = 'from shared.utils.formatters import format_user';
    const tree = parseCode(code, 'python');
    const imports = extractPythonImports(tree, 'test.py');
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('shared.utils.formatters');
  });
});

describe('extractPythonExports', () => {
  it('treats non-underscore top-level names as exports', () => {
    const code = `def public_func():\n    pass\n\ndef _private_func():\n    pass\n\nclass MyClass:\n    pass\n\nCONSTANT = 42`;
    const tree = parseCode(code, 'python');
    const exports = extractPythonExports(tree, 'test.py');
    const names = exports.map((e) => e.name);
    expect(names).toContain('public_func');
    expect(names).toContain('MyClass');
    expect(names).toContain('CONSTANT');
    expect(names).not.toContain('_private_func');
  });

  it('uses __all__ when present', () => {
    const code = `__all__ = ['foo', 'bar']\n\ndef foo():\n    pass\n\ndef bar():\n    pass\n\ndef baz():\n    pass`;
    const tree = parseCode(code, 'python');
    const exports = extractPythonExports(tree, 'test.py');
    const names = exports.map((e) => e.name);
    expect(names).toEqual(['foo', 'bar']);
    expect(names).not.toContain('baz');
  });
});
