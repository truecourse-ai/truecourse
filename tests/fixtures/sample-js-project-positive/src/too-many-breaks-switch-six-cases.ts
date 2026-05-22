/**
 * Positive fixture for code-quality/deterministic/too-many-breaks.
 *
 * A standard non-fallthrough `switch` over six labels has six `break;`
 * statements — one per case — purely as required syntax. None of them
 * represent the kind of control-flow branching the rule is meant to
 * discourage; the rule should only count breaks that target a surrounding
 * loop.
 */

type StatusKind = 'unsigned' | 'opened' | 'waiting' | 'completed' | 'rejected';

export function classNameForStatus(kind: StatusKind): string {
  let className = 'tone-muted';
  switch (kind) {
    case 'unsigned':
      className = 'tone-neutral';
      break;
    case 'opened':
      className = 'tone-warning';
      break;
    case 'waiting':
      className = 'tone-info';
      break;
    case 'completed':
      className = 'tone-success';
      break;
    case 'rejected':
      className = 'tone-danger';
      break;
    default:
      break;
  }
  return className;
}
