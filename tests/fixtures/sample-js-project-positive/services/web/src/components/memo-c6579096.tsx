import { useState } from "react";
export function Component_c6579096(props: { items: number[] }) {
  const [n] = useState(0);
  const sorted = props.items.slice().sort((a, b) => a - b).map(x => x * 2).filter(x => x > n);
  return <div>{sorted.join(",")}</div>;
}
