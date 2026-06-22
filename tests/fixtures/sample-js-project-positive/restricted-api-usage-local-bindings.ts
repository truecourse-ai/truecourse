// Two local bindings that happen to share a name with a restricted global:
//   - `event` as an index-signature parameter name is just the local name
//     for the key type, not the implicit global `event`.
//   - `location` as a generator function's destructured parameter is that
//     function's own binding, not the global `location`.
// Neither should be reported as restricted global usage.

export interface EventHandlerMap {
  [event: string]: (payload: unknown) => void;
}

export const placeStream = {
  generate: async function* ({ location }: { location: string }) {
    yield location.toUpperCase();
  },
};
