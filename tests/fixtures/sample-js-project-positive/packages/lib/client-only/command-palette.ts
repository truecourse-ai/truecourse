
// FP: `import { Command as CommandPrimitive } from 'cmdk'` — ES imports are hoisted and
// fully resolved before any code runs. Not a use-before-define issue.
declare const CommandPrimitive: {
  Root: unknown;
  Input: unknown;
  List: unknown;
  Item: unknown;
  Empty: unknown;
};
declare const React: { forwardRef: (fn: unknown) => unknown; ElementRef: unknown; ComponentPropsWithoutRef: unknown };

const CommandRoot = React.forwardRef((props: unknown, ref: unknown) => {
  return null;
});
