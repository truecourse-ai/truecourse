// JSX in a plain `.jsx` file (no TypeScript). The no-undef rule must
// recognise lowercase JSX element names (`div`, `span`, `h1`,
// custom-element names with hyphens) as intrinsic HTML / SVG tags - not
// JavaScript variable references. Capitalised tag names (`Provider`,
// `MyButton`) ARE component references and should still be checked.
const Greeting = ({ name }) => (
  <section>
    <h1 className="title">Hello, {name}!</h1>
    <span data-test="greeting-body">welcome</span>
    <my-custom-element data-id="42" />
  </section>
);

module.exports = { Greeting };
