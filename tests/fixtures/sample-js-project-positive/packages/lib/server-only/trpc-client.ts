
// typeof check on a context value that holds a typed string — standard type guard pattern
declare const opts: { op: { context: { teamId?: unknown } } };

function getTeamIdHeader(opts: { op: { context: { teamId?: unknown } } }) {
  if (typeof opts.op.context.teamId === 'string') {
    return { 'x-team-id': opts.op.context.teamId };
  }
  return {};
}
