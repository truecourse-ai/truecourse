/**
 * inline-object-in-jsx-prop shapes that should NOT fire:
 * - framer-motion config props (`initial`/`animate`/`exit`/`transition`/`variants`/`while*`).
 * - <Trans values={{…}} components={{…}}>.
 * - Style with dynamic value (`style={{ width: \`${pct}%\` }}`).
 * - dangerouslySetInnerHTML.
 */

import type React from "react";

declare const motion: {
  div: (props: {
    initial?: object;
    animate?: object;
    exit?: object;
    transition?: object;
    whileHover?: object;
    children?: React.ReactNode;
  }) => JSX.Element;
};

declare const Trans: (props: {
  values?: object;
  components?: object;
  i18nKey: string;
}) => JSX.Element;

export interface Output {
  motionEl: JSX.Element;
  trans: JSX.Element;
  dynStyle: JSX.Element;
}

export function shapes(name: string, pct: number): Output {
  // framer-motion props: documented inline-object API.
  const motionEl = (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      whileHover={{ scale: 1.05 }}
    />
  );

  // <Trans> closes over per-render values + JSX children.
  const trans = (
    <Trans
      i18nKey="hello"
      values={{ name }}
      components={{ b: <b /> }}
    />
  );

  // style with dynamic value — cannot be hoisted.
  const dynStyle = <div style={{ width: `${pct}%` }} />;

  return { motionEl, trans, dynStyle };
}
