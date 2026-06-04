// Generated from src/grammar/MiniGrammar.g4 by ANTLR 4.9.0-SNAPSHOT

type Recoverable = { recoverInline: () => void; reportMatch: () => void };
type State = { la: number; matchedEOF: boolean };

const TOKEN_FN = 1;
const TOKEN_FUN = 2;
const TOKEN_EOF = -1;

export function applyTransitions(
  state: State,
  handler: Recoverable,
  consume: () => void,
): void {
  if (!(state.la === TOKEN_FN || state.la === TOKEN_FUN)) {
    handler.recoverInline();
  } else {
    if (state.la === TOKEN_EOF) {
      state.matchedEOF = true;
    }
    handler.reportMatch();
    consume();
  }
}
