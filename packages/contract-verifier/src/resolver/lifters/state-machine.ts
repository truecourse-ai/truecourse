import type { StatementNode, HeadToken } from '../../parser/index.js';
import type { StateMachineContract, ArtifactRef } from '../../types/index.js';

export function liftStateMachine(identity: string, body: StatementNode[]): StateMachineContract {
  // Identity for state machines is `Type.field` (e.g. `Order.status`).
  // Synthesize the scope ref from that — caller provides the lifted
  // identity verbatim.
  const [typeName, field] = identity.split('.');

  let statesRef: ArtifactRef = { type: 'Enum', identity: 'Unknown', quoted: false };
  const initial: string[] = [];
  const terminal: string[] = [];
  const transitions: { from: string; to: string }[] = [];

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    const k = h[0].value;

    if (k === 'states' && h[1]?.kind === 'reference') {
      statesRef = {
        type: h[1].refType as ArtifactRef['type'],
        identity: h[1].identity,
        quoted: h[1].quoted,
      };
      continue;
    }
    if (k === 'initial' && h[1]?.kind === 'list') {
      for (const item of h[1].items) {
        if (item.kind === 'ident') initial.push(item.value);
      }
      continue;
    }
    if (k === 'terminal' && h[1]?.kind === 'list') {
      for (const item of h[1].items) {
        if (item.kind === 'ident') terminal.push(item.value);
      }
      continue;
    }
    if (k === 'transitions' && stmt.block) {
      for (const t of stmt.block) {
        // Each transition statement: `<from> -> <to>` or `<from> -> [<to>, ...]`
        const th = t.head;
        if (th.length < 3) continue;
        if (th[0].kind !== 'ident') continue;
        const arrowIdx = th.findIndex((tok) => tok.kind === 'op' && tok.value === '->');
        if (arrowIdx <= 0) continue;
        const fromTok = th[arrowIdx - 1];
        const toTok = th[arrowIdx + 1];
        if (!fromTok || !toTok) continue;

        const fromStates = collectStateNames([fromTok]);
        const toStates = collectStateNames([toTok]);
        for (const f of fromStates) for (const to of toStates) transitions.push({ from: f, to });
      }
      continue;
    }
  }

  return {
    scope: {
      entityRef: { type: 'Entity', identity: typeName, quoted: false },
      field,
    },
    statesRef,
    initial,
    terminal,
    transitions,
  };
}

function collectStateNames(tokens: HeadToken[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    if (t.kind === 'ident') out.push(t.value);
    else if (t.kind === 'list') {
      for (const item of t.items) if (item.kind === 'ident') out.push(item.value);
    }
  }
  return out;
}
