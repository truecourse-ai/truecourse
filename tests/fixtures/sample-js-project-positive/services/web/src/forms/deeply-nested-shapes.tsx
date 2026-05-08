/**
 * deeply-nested-functions FP shape: React-component helper
 * closures `export const Foo = () => { const a = () => { const
 * b = () => { const c = () => {...} } } }`. The 4 const-
 * assigned arrows are component + 3 helper closures, not
 * deeply nested business logic.
 */

declare const useState: <T>(init: T) => readonly [T, (v: T) => void];

export const Component = ({ items }: { items: readonly string[] }): JSX.Element => {
  const [count, setCount] = useState(0);

  const renderItem = (item: string, idx: number): string => {
    const computeLabel = (i: number): string => {
      const formatItem = (s: string): string => {
        return `${i}: ${s}`;
      };
      return items.map(formatItem).join(",");
    };
    return `${idx}/${item}: ${computeLabel(idx)}`;
  };

  return (
    <div>
      <button onClick={() => setCount(count + 1)}>{count}</button>
      <pre>{items.map(renderItem).join("\n")}</pre>
    </div>
  );
};
