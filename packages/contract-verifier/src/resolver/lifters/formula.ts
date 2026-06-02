import type { StatementNode, HeadToken } from '../../parser/index.js';
import type { FormulaContract, ArtifactRef } from '../../types/index.js';

export function liftFormula(body: StatementNode[]): FormulaContract {
  let output: FormulaContract['output'] | null = null;
  const inputs: FormulaContract['inputs'] = [];
  let expression: FormulaContract['expression'] = { kind: 'simple', raw: '' };
  let computedAt = 'order-creation';
  let immutableAfterCreation = false;
  const dependsOn: ArtifactRef[] = [];

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    const k = h[0].value;

    if (k === 'output' && h[1]?.kind === 'reference' && h[2]?.kind === 'ident' && h[2].value === 'field' && h[3]?.kind === 'ident') {
      output = {
        entityRef: { type: h[1].refType as ArtifactRef['type'], identity: h[1].identity, quoted: h[1].quoted },
        field: h[3].value,
      };
      continue;
    }

    if (k === 'inputs' && h[1]?.kind === 'list') {
      for (const item of h[1].items) {
        if (item.kind !== 'reference') continue;
        // Identity is `<Entity>.<field>` — split.
        const dot = item.identity.lastIndexOf('.');
        if (dot < 0) continue;
        const entityIdentity = item.identity.slice(0, dot);
        const field = item.identity.slice(dot + 1);
        inputs.push({
          entityRef: { type: item.refType as ArtifactRef['type'], identity: entityIdentity, quoted: item.quoted },
          field,
        });
      }
      continue;
    }

    if (k === 'expression') {
      // Two forms: `expression "raw string"` OR `expression { when "..." then "..." else "..." }`
      if (h[1]?.kind === 'string') {
        expression = { kind: 'simple', raw: h[1].value };
      } else if (stmt.block) {
        let when = '', then = '', els = '';
        for (const inner of stmt.block) {
          const ih = inner.head;
          if (ih.length < 2 || ih[0].kind !== 'ident') continue;
          if (ih[0].value === 'when' && ih[1].kind === 'string') when = ih[1].value;
          else if (ih[0].value === 'then' && ih[1].kind === 'string') then = ih[1].value;
          else if (ih[0].value === 'else' && ih[1].kind === 'string') els = ih[1].value;
        }
        expression = { kind: 'conditional', when, then, else: els };
      }
      continue;
    }

    if (k === 'computed-at' && h[1]?.kind === 'ident') {
      computedAt = h[1].value;
      continue;
    }

    if (k === 'immutable-after-creation') {
      immutableAfterCreation = true;
      continue;
    }

    if (k === 'depends-on') {
      const collect = (t: HeadToken): void => {
        if (t.kind === 'reference') {
          dependsOn.push({ type: t.refType as ArtifactRef['type'], identity: t.identity, quoted: t.quoted });
        } else if (t.kind === 'list') {
          for (const item of t.items) collect(item);
        }
      };
      for (let i = 1; i < h.length; i++) collect(h[i]);
      continue;
    }
  }

  if (!output) {
    // Synthetic placeholder so the type stays valid; comparator will skip.
    output = {
      entityRef: { type: 'Entity', identity: 'Unknown', quoted: false },
      field: 'unknown',
    };
  }

  return { output, inputs, expression, computedAt, immutableAfterCreation, dependsOn };
}
