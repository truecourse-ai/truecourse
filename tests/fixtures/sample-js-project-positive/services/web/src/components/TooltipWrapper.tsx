/**
 * React component that returns different JSX shapes depending on a
 * branch condition. Both branches resolve to `React.ReactNode` /
 * `JSX.Element`, but their TypeScript type strings differ.
 *
 * The function-return-type-varies rule should NOT fire on PascalCase
 * components that return JSX — they're component functions and the
 * union of valid React-node shapes is the expected behavior.
 *
 * Mirrors OpenHands `frontend/src/components/features/chat/git-control-bar-tooltip-wrapper.tsx:10`.
 */

interface TooltipWrapperProps {
  readonly tooltipMessage: string;
  readonly children: React.ReactNode;
  readonly shouldShowTooltip: boolean;
}

export function TooltipWrapper({
  tooltipMessage,
  children,
  shouldShowTooltip,
}: TooltipWrapperProps): JSX.Element | React.ReactNode {
  if (!shouldShowTooltip) {
    return children;
  }
  return (
    <div title={tooltipMessage} className="hover:opacity-100">
      {children}
    </div>
  );
}
