/**
 * Positive fixture for code-quality/deterministic/default-case-in-switch.
 *
 * A reducer over a discriminated union — TypeScript already enforces
 * exhaustiveness statically, so a `default` case is unreachable. The
 * visitor's "all cases terminate" check has to peer inside block-bodied
 * cases (`case 'X': { … return Y; }`) for this to be recognised — that's
 * a common pattern when one branch needs to introduce a local `const`.
 */

type NoticeAction =
  | { type: 'append'; item: { id: string; label: string } }
  | { type: 'drop'; id: string }
  | { type: 'reset' };

type NoticeState = { items: Array<{ id: string; label: string }> };

export function noticeReducer(state: NoticeState, action: NoticeAction): NoticeState {
  switch (action.type) {
    case 'append':
      return { items: [...state.items, action.item] };

    case 'drop': {
      const { id } = action;
      return { items: state.items.filter((it) => it.id !== id) };
    }

    case 'reset': {
      return { items: [] };
    }
  }
}
