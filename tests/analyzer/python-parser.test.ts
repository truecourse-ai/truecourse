import { describe, it, expect } from 'vitest';
import { parseCode, getParser } from '../../packages/analyzer/src/parser';
import { detectLanguage } from '../../packages/analyzer/src/language-config';

describe('Python parser', () => {
  it('parses Python code and returns a tree with rootNode', () => {
    const code = 'x = 42';
    const tree = parseCode(code, 'python');
    expect(tree).toBeDefined();
    expect(tree.rootNode).toBeDefined();
    expect(tree.rootNode.type).toBe('module');
  });

  it('returns a cached parser (same instance on second call)', () => {
    const parser1 = getParser('python');
    const parser2 = getParser('python');
    expect(parser1).toBe(parser2);
  });

  it('detects .py files as python', () => {
    expect(detectLanguage('app.py')).toBe('python');
    expect(detectLanguage('main.py')).toBe('python');
    expect(detectLanguage('__init__.py')).toBe('python');
  });

  it('produces correct AST for a function definition', () => {
    const code = 'def greet(name: str) -> str:\n    return f"Hello {name}"';
    const tree = parseCode(code, 'python');
    const funcNode = tree.rootNode.namedChildren.find(
      (child) => child.type === 'function_definition'
    );
    expect(funcNode).toBeDefined();
    expect(funcNode!.childForFieldName('name')?.text).toBe('greet');
  });

  it('produces correct AST for a class definition', () => {
    const code = 'class User:\n    name: str\n    def greet(self):\n        pass';
    const tree = parseCode(code, 'python');
    const classNode = tree.rootNode.namedChildren.find(
      (child) => child.type === 'class_definition'
    );
    expect(classNode).toBeDefined();
    expect(classNode!.childForFieldName('name')?.text).toBe('User');
  });

  it('produces correct AST for imports', () => {
    const code = 'from flask import Flask\nimport os';
    const tree = parseCode(code, 'python');
    const imports = tree.rootNode.namedChildren.filter(
      (child) => child.type === 'import_statement' || child.type === 'import_from_statement'
    );
    expect(imports).toHaveLength(2);
  });
});
