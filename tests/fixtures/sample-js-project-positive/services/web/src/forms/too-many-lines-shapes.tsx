/**
 * too-many-lines shapes that should NOT fire:
 *
 * React FC where the bulk of the body is JSX markup. A long
 * JSX tree is structural, not logic complexity — counting it
 * the same as a 200-line algorithmic function over-flags
 * UI components.
 */

import { useState } from "react";

type Item = { id: string; label: string; value: number };

interface Props {
  readonly items: ReadonlyArray<Item>;
  readonly onSelect: (id: string) => void;
}

export function ItemList(props: Props): JSX.Element {
  const [filter, setFilter] = useState("");
  const visible = props.items.filter((i) => i.label.includes(filter));

  return (
    <section className="item-list">
      <header className="item-list__header">
        <h2>Items</h2>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search"
          aria-label="Filter items"
        />
      </header>
      <ul className="item-list__body">
        {visible.map((item) => (
          <li key={item.id} className="item-list__row">
            <button
              type="button"
              onClick={() => props.onSelect(item.id)}
              className="item-list__btn"
              aria-label={`Select ${item.label}`}
            >
              <span className="item-list__label">{item.label}</span>
              <span className="item-list__value">{item.value}</span>
              <span className="item-list__chevron" aria-hidden>
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <path d="M3 4 l3 3 l3 -3" stroke="currentColor" />
                </svg>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <aside className="item-list__sidebar">
        <h3>Selected categories</h3>
        <ul>
          <li>
            <span className="dot" />
            <span>Featured</span>
          </li>
          <li>
            <span className="dot" />
            <span>On sale</span>
          </li>
          <li>
            <span className="dot" />
            <span>New arrivals</span>
          </li>
        </ul>
      </aside>
      <footer className="item-list__footer">
        <p>Total: {visible.length}</p>
        <button
          type="button"
          onClick={() => setFilter("")}
          className="item-list__reset"
        >
          Reset
        </button>
      </footer>
    </section>
  );
}
