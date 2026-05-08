/**
 * cyclomatic-complexity shape that should NOT fire:
 *
 * "Switch as dispatch table" — every case is a single return
 * mapping an input to a result. Cyclomatically each case is
 * counted as a branch, but the function has no decision
 * logic; it's a lookup table. Real complexity is 1.
 *
 * Threshold is >10. The switch below has 14 dispatch arms.
 */

export function eventLabel(kind: string): string {
  switch (kind) {
    case "click":
      return "Click";
    case "hover":
      return "Hover";
    case "focus":
      return "Focus";
    case "blur":
      return "Blur";
    case "submit":
      return "Submit";
    case "reset":
      return "Reset";
    case "change":
      return "Change";
    case "input":
      return "Input";
    case "scroll":
      return "Scroll";
    case "resize":
      return "Resize";
    case "load":
      return "Load";
    case "unload":
      return "Unload";
    case "keydown":
      return "Key down";
    case "keyup":
      return "Key up";
    case "keypress":
      return "Key press";
    default:
      return "Unknown";
  }
}
