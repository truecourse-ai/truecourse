// An empty object pattern `{}` used as a function parameter is a deliberate
// placeholder for a fixed callback signature, not a binding mistake. Two common
// shapes: a render callback whose component takes no props but still receives a
// `ref` argument, and a test-runner fixture whose first argument is a typed
// context object the body does not need. The positional slot is dictated by the
// framework, so the empty pattern cannot be removed.

interface FixtureContext {
  seed: number;
}

type RenderFn = (props: Record<string, never>, ref: { current: unknown }) => string;
type UseFn = () => Promise<void>;

declare function registerRenderer(render: RenderFn): void;
declare function defineFixture(
  setup: (ctx: FixtureContext, use: UseFn) => Promise<void>,
): void;

registerRenderer(({}, ref) => String(ref.current));

defineFixture(async ({}: FixtureContext, use) => {
  await use();
});
