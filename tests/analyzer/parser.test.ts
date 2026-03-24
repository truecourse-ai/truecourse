import { describe, it, expect } from 'vitest';
import { parseCode, getParser, parseFile } from '../../packages/analyzer/src/parser';
import { detectLanguage } from '../../packages/analyzer/src/language-config';

describe('parseCode', () => {
  it('parses TypeScript code and returns a tree with rootNode', () => {
    const code = 'const x: number = 42;';
    const tree = parseCode(code, 'typescript');
    expect(tree).toBeDefined();
    expect(tree.rootNode).toBeDefined();
    expect(tree.rootNode.type).toBe('program');
  });

  it('parses JavaScript code and returns a tree with rootNode', () => {
    const code = 'const x = 42;';
    const tree = parseCode(code, 'javascript');
    expect(tree).toBeDefined();
    expect(tree.rootNode).toBeDefined();
    expect(tree.rootNode.type).toBe('program');
  });

  it('produces correct AST node types for a function declaration', () => {
    const code = 'function greet(name: string): void { console.log(name); }';
    const tree = parseCode(code, 'typescript');
    const rootNode = tree.rootNode;

    const functionNode = rootNode.children.find(
      (child) => child.type === 'function_declaration'
    );
    expect(functionNode).toBeDefined();
    expect(functionNode!.type).toBe('function_declaration');
  });
});

describe('getParser', () => {
  it('returns a cached parser (same instance on second call)', () => {
    const parser1 = getParser('typescript');
    const parser2 = getParser('typescript');
    expect(parser1).toBe(parser2);
  });

  it('throws for unsupported language', () => {
    expect(() => getParser('python' as any)).toThrow('Unsupported language');
  });
});

describe('parseFile', () => {
  it('wraps errors with file path', () => {
    // Passing an unsupported language through parseFile should include the file path in the error
    expect(() => parseFile('/some/file.py', 'x = 1', 'python' as any)).toThrow(
      '/some/file.py'
    );
  });
});

describe('detectLanguage', () => {
  it("returns 'typescript' for .ts files", () => {
    expect(detectLanguage('app.ts')).toBe('typescript');
  });

  it("returns 'tsx' for .tsx files", () => {
    expect(detectLanguage('component.tsx')).toBe('tsx');
  });

  it("returns 'javascript' for .js files", () => {
    expect(detectLanguage('app.js')).toBe('javascript');
  });

  it("returns 'javascript' for .jsx files", () => {
    expect(detectLanguage('component.jsx')).toBe('javascript');
  });

  it('returns null for unsupported extensions', () => {
    expect(detectLanguage('script.py')).toBeNull();
    expect(detectLanguage('Program.cs')).toBeNull();
    expect(detectLanguage('main.go')).toBeNull();
    expect(detectLanguage('README.md')).toBeNull();
    expect(detectLanguage('config.json')).toBeNull();
  });
});
