/**
 * The provider-side contract for STRICT structured output, re-encoded here as an
 * independent check on what the transport actually submits. Written from the
 * OpenAI strict-schema rules rather than from the normalizer's code, so a
 * normalizer that stops satisfying them fails the suite:
 *
 *  1. every object node's `required` lists EVERY key of its `properties`;
 *  2. every object node carries `additionalProperties: false`;
 *  3. no `default` keyword ("'default' is not permitted");
 *  4. no `$schema` meta-annotation;
 *  5. an array's `items` is a single schema, never a positional tuple.
 */

import { expect } from 'vitest';

type JsonObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function at(path: string): string {
  return path || '(root)';
}

/** Assert `schema` is submittable as a strict structured-output schema. */
export function assertOpenAiStrictValid(schema: unknown, label = 'schema'): void {
  const problems: string[] = [];

  const visit = (node: unknown, path: string): void => {
    if (!isPlainObject(node)) {
      problems.push(`${at(path)}: not a schema object`);
      return;
    }
    if (Object.keys(node).length === 0) {
      problems.push(`${at(path)}: open \`{}\` sub-schema`);
      return;
    }
    if ('default' in node) problems.push(`${at(path)}: 'default' is not permitted`);
    if ('$schema' in node) problems.push(`${at(path)}: '$schema' is not permitted`);

    const under = (segment: string) => (path ? `${path}.${segment}` : segment);

    if (isPlainObject(node.properties)) {
      const keys = Object.keys(node.properties);
      const required = Array.isArray(node.required) ? node.required : [];
      const missing = keys.filter((k) => !required.includes(k));
      if (missing.length > 0) {
        problems.push(`${at(path)}: 'required' is missing ${missing.map((m) => `'${m}'`).join(', ')}`);
      }
      for (const [key, child] of Object.entries(node.properties)) {
        visit(child, under(`properties.${key}`));
      }
    }

    if (node.type === 'object' || isPlainObject(node.properties)) {
      if (node.additionalProperties !== false) {
        problems.push(`${at(path)}: 'additionalProperties' must be present and false`);
      }
    } else if ('additionalProperties' in node && node.additionalProperties !== false) {
      problems.push(`${at(path)}: 'additionalProperties' must be false`);
    }

    if ('items' in node) {
      if (Array.isArray(node.items)) problems.push(`${at(path)}: tuple 'items' is not supported`);
      else visit(node.items, under('items'));
    }

    for (const key of ['anyOf', 'oneOf'] as const) {
      const branches = node[key];
      if (Array.isArray(branches)) {
        branches.forEach((b, i) => visit(b, under(`${key}[${i}]`)));
      }
    }
  };

  if (!isPlainObject(schema) || schema.type !== 'object') {
    problems.push('(root): strict output requires an object-rooted schema');
  } else {
    visit(schema, '');
  }

  expect(problems, `${label} is not strict-valid:\n  ${problems.join('\n  ')}`).toEqual([]);
}
