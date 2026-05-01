// React-style array-pattern destructuring from `useState`. The scope tracker
// must register both `open` and `setOpen` as bindings in the enclosing
// scope, otherwise every reference inside the component looks undeclared
// to no-undef.
const useState = (init) => [init, (next) => next];

const Toggle = () => {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  if (open) {
    close();
  }
  return null;
};

module.exports = { Toggle };

// for...of with array-pattern destructuring. Bindings `tier` and `count`
// must be in scope inside the loop body.
const score = (counts) => {
  let total = 0;
  for (const [tier, count] of Object.entries(counts)) {
    total += tier.length * count;
  }
  return total;
};
module.exports.score = score;

// Arrow callback inside an exported function. The inner `(p, i) => …`
// is NOT itself an export - it's a callback to `.map()` inside the
// enclosing function body. The export-walker must stop at function
// boundaries; otherwise the synthesized `map_handler` name leaks into
// `unused-export` and `dead-method` and produces hundreds of FPs on
// any React component that maps over an array.
const PAGES = ['home', 'about', 'contact'];
export const App = () => PAGES.map((p, i) => ({ name: p, idx: i }));

// Plain JS doesn't have `noUncheckedIndexedAccess` semantics to opt
// into - every index access is `T | undefined` regardless. The
// unchecked-array-access rule should only run on TS / TSX where the
// flag is meaningful; on JS it's pure noise.
export const indexAt = (arr, i) => arr[i];

// Prototype-pollution: key derived from a for-of iteration variable's
// own property. The iteration value `r` came from the caller's `rows`
// array but the key is internal-state-shaped, not user-input. Without
// this suppression every aggregation loop fires.
export const tally = (rows) => {
  const counts = { gold: 0, silver: 0, bronze: 0 };
  for (const r of rows) {
    const tier = r.infraction_tier;
    counts[tier] = (counts[tier] || 0) + 1;
  }
  return counts;
};

// Prototype-pollution: explicitly guarded with `if (key in obj)`. The
// guard rejects `__proto__` / `constructor` / `prototype` because those
// aren't own keys of the literal `counts`. The rule must skip writes
// inside such guards.
export const tallyGuarded = (rows) => {
  const counts = { gold: 0, silver: 0, bronze: 0 };
  for (const r of rows) {
    const tier = r.infraction_tier;
    if (tier in counts) {
      counts[tier] = (counts[tier] || 0) + 1;
    }
  }
  return counts;
};
