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
