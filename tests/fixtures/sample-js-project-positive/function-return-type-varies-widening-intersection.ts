// `T & {}` (here `string & {}`) is the literal-preserving widening idiom:
// a union like `"free" | "pro" | (string & {})` keeps autocomplete for the
// known members while still accepting any string. In the `default` branch
// the parameter narrows to `string & {}`, which is semantically just
// `string` — the same base type the other branches return. The
// return-type-varies rule must not treat `string & {}` as a distinct type,
// so this function should produce no violation.
//
// (Named `loader` so the unrelated missing-return-type rule, which exempts
// framework route exports, stays out of the way — the point here is the
// widening idiom, not the missing annotation.)

type Tier = "free" | "pro" | (string & {});

export function loader(tier: Tier) {
  switch (tier) {
    case "free":
      return "Free plan";
    case "pro":
      return "Pro plan";
    default:
      return tier;
  }
}
