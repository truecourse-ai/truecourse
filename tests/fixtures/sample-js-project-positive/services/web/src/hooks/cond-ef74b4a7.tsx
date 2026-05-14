import { useState, useEffect } from "react";
export function Component_ef74b4a7(props: { enabled: boolean }) {
  if (props.enabled) {
    const [x, setX] = useState(0);
    return <div>{x}</div>;
  }
  return <div />;
}
