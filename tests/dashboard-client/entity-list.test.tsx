/**
 * The shared list component's own tests — the behaviours every list surface now
 * inherits instead of implementing:
 *
 *   SEARCH   one input, the surface's predicate, and a controlled mode for a
 *            surface whose rows come from a server query.
 *   FILTER   count chips, single-select with toggle-off, multi-select with a
 *            clear link, and the typeahead shape above a dozen options.
 *   GROUPS   headers with counts and hover explainers, one nesting level,
 *            collapsible where a surface asks for it.
 *   ROWS     single-click previews, double-click pins, Enter previews, and a row
 *            a surface marks non-interactive does none of it.
 *   STATES   loading, error, nothing-at-all, nothing-matches — one spelling each.
 *
 * A surface test asserts what that surface shows; THIS file is where the shared
 * mechanics are pinned, so no surface has to re-prove them.
 */

import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntityList, type EntityListGroup } from '@/components/ui/entity-list';

interface Item {
  id: string;
  title: string;
  kind: 'fruit' | 'veg';
}

const ITEMS: Item[] = [
  { id: 'a', title: 'apple', kind: 'fruit' },
  { id: 'b', title: 'banana', kind: 'fruit' },
  { id: 'c', title: 'carrot', kind: 'veg' },
];

const BASE = {
  label: 'Produce',
  itemId: (i: Item) => i.id,
  renderRow: (i: Item) => <span>{i.title}</span>,
};

const list = () => screen.getByRole('list', { name: 'Produce' });
const rows = () => within(list()).getAllByRole('listitem');
const rowTexts = () => rows().map((r) => r.textContent);

describe('EntityList — search', () => {
  it('narrows through the surface’s predicate, under one labelled input', async () => {
    const user = userEvent.setup();
    render(
      <EntityList<Item>
        {...BASE}
        items={ITEMS}
        search={{
          placeholder: 'Search produce…',
          ariaLabel: 'Search produce',
          match: (i, q) => i.title.includes(q),
        }}
      />,
    );
    await user.type(screen.getByLabelText('Search produce'), 'an');
    expect(rowTexts()).toEqual(['banana']);
  });

  it('is controlled when the surface owns the query (a server-side search)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <EntityList<Item>
        {...BASE}
        items={ITEMS}
        search={{ placeholder: 'p', ariaLabel: 'Search produce', value: 'car', onChange }}
      />,
    );
    // No predicate: the source already filtered, so every row stays.
    expect(rowTexts()).toHaveLength(3);
    expect(screen.getByLabelText('Search produce')).toHaveValue('car');
    await user.type(screen.getByLabelText('Search produce'), 'x');
    expect(onChange).toHaveBeenCalledWith('carx');
  });

  it('says so when the search keeps nothing — never an empty list region', async () => {
    const user = userEvent.setup();
    render(
      <EntityList<Item>
        {...BASE}
        items={ITEMS}
        search={{ placeholder: 'p', ariaLabel: 'Search produce', match: (i, q) => i.title.includes(q) }}
        noMatch="No produce matches this search."
      />,
    );
    await user.type(screen.getByLabelText('Search produce'), 'zzz');
    expect(screen.getByText('No produce matches this search.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Produce' })).not.toBeInTheDocument();
  });
});

describe('EntityList — the filter idiom', () => {
  const filterProps = (selected: string[], onChange: (n: string[]) => void, multi = false) => ({
    label: 'Kind',
    ariaLabel: 'Filter by kind',
    options: [
      { key: 'fruit', label: 'Fruit', count: 2 },
      { key: 'veg', label: 'Veg', count: 1 },
    ],
    selected,
    onChange,
    match: (i: Item, key: string) => i.kind === key,
    ...(multi ? { multi: true } : {}),
  });

  /** The filter state lives above the list, exactly as every surface holds it. */
  function Harness({ multi = false }: { multi?: boolean }) {
    const [selected, setSelected] = useState<string[]>([]);
    return <EntityList<Item> {...BASE} items={ITEMS} filter={filterProps(selected, setSelected, multi)} />;
  }

  it('offers a count chip per option and narrows to the one clicked', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const bar = screen.getByRole('group', { name: 'Filter by kind' });
    expect(within(bar).getByRole('button', { name: 'Fruit 2' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Veg 1' })).toBeInTheDocument();
    // No `<select>` anywhere — the chips ARE the filter.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    await user.click(within(bar).getByRole('button', { name: 'Veg 1' }));
    expect(rowTexts()).toEqual(['carrot']);
    expect(within(bar).getByRole('button', { name: 'Veg 1' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clears on a second click of the active chip (toggle-off)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const chip = () => within(screen.getByRole('group', { name: 'Filter by kind' })).getByRole('button', { name: 'Veg 1' });
    await user.click(chip());
    expect(rowTexts()).toEqual(['carrot']);
    await user.click(chip());
    expect(rowTexts()).toHaveLength(3);
  });

  it('multi-select keeps several options at once, with one clear', async () => {
    const user = userEvent.setup();
    render(<Harness multi />);
    const bar = () => screen.getByRole('group', { name: 'Filter by kind' });
    await user.click(within(bar()).getByRole('button', { name: 'Fruit 2' }));
    await user.click(within(bar()).getByRole('button', { name: 'Veg 1' }));
    expect(rowTexts()).toHaveLength(3);
    await user.click(within(bar()).getByRole('button', { name: 'clear' }));
    expect(within(bar()).getByRole('button', { name: 'Fruit 2' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('becomes a typeahead above a dozen options — the same model, a readable shape', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 13 }, (_, i) => ({ key: `k${i}`, label: `tag-${i}`, count: i }));
    render(
      <EntityList<Item>
        {...BASE}
        items={ITEMS}
        filter={{
          label: 'Tags',
          ariaLabel: 'Filter by tag',
          options: many,
          selected: [],
          onChange: () => {},
          match: () => true,
          multi: true,
        }}
      />,
    );
    // Not 13 chips: one input that narrows the options.
    const input = screen.getByLabelText('Type to filter Tags');
    await user.type(input, 'tag-12');
    expect(screen.getByRole('button', { name: /tag-12/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tag-3/ })).not.toBeInTheDocument();
  });
});

describe('EntityList — groups', () => {
  const groups: EntityListGroup<Item>[] = [
    { key: 'fruit', label: 'Fruit', count: 2, items: ITEMS.slice(0, 2), hint: 'sweet ones' },
    { key: 'veg', label: 'Veg', name: 'veg rows', count: 1, collapsible: true, defaultOpen: false, items: ITEMS.slice(2) },
  ];

  it('heads each group with its label, count and hint — inside ONE list region', () => {
    render(<EntityList<Item> {...BASE} groups={groups} />);
    expect(within(list()).getByText('Fruit')).toBeInTheDocument();
    expect(within(list()).getByText('sweet ones')).toBeInTheDocument();
    // The collapsed group's rows are absent; the open one's are there.
    expect(rowTexts()).toEqual(['apple', 'banana']);
  });

  it('collapses only where a surface asks for it, and says which way it goes', async () => {
    const user = userEvent.setup();
    render(<EntityList<Item> {...BASE} groups={groups} />);
    const toggle = screen.getByRole('button', { name: 'Expand veg rows' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(rowTexts()).toEqual(['apple', 'banana', 'carrot']);
    expect(screen.getByRole('button', { name: 'Collapse veg rows' })).toBeInTheDocument();
    // A group with no `collapsible` has no toggle at all.
    expect(screen.queryByRole('button', { name: /Fruit/ })).not.toBeInTheDocument();
  });

  it('nests one level — a doc’s sections under the doc', () => {
    render(
      <EntityList<Item>
        {...BASE}
        groups={[
          {
            key: 'doc',
            label: 'docs/tasks.md',
            groups: [{ key: 'sec', label: 'Creating tasks', count: 1, items: [ITEMS[0]] }],
          },
        ]}
      />,
    );
    expect(within(list()).getByText('docs/tasks.md')).toBeInTheDocument();
    expect(within(list()).getByText('Creating tasks')).toBeInTheDocument();
    expect(rowTexts()).toEqual(['apple']);
  });

  it('explains a group through HoverPopover, never an HTML title', () => {
    render(
      <EntityList<Item>
        {...BASE}
        groups={[{ key: 'g', label: 'Not claimed', help: 'nothing can falsify these', items: [ITEMS[0]] }]}
      />,
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('nothing can falsify these');
    expect(within(list()).getByText('Not claimed').closest('[title]')).toBeNull();
  });
});

describe('EntityList — rows', () => {
  it('previews on single click, pins on double click, previews on Enter', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<EntityList<Item> {...BASE} items={ITEMS} onOpen={onOpen} />);
    await user.click(screen.getByText('apple'));
    expect(onOpen).toHaveBeenLastCalledWith('a', false);
    await user.dblClick(screen.getByText('apple'));
    expect(onOpen).toHaveBeenLastCalledWith('a', true);
    onOpen.mockClear();
    rows()[1].focus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith('b', false);
  });

  it('paints the active row and marks it for assistive tech', () => {
    render(<EntityList<Item> {...BASE} items={ITEMS} activeId="b" onOpen={() => {}} />);
    const active = screen.getByText('banana').closest('[role="listitem"]') as HTMLElement;
    expect(active.className).toContain('bg-primary/10');
    expect(active).toHaveAttribute('aria-current', 'true');
  });

  it('a row the surface marks non-interactive is not a click target at all', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <EntityList<Item>
        {...BASE}
        items={ITEMS}
        onOpen={onOpen}
        rowInteractive={(i) => i.kind === 'fruit'}
      />,
    );
    const carrot = screen.getByText('carrot').closest('[role="listitem"]') as HTMLElement;
    expect(carrot).not.toHaveAttribute('tabindex');
    await user.click(carrot);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('EntityList — states', () => {
  it('shows the count line with the preview/pin rule as its hover help', () => {
    render(
      <EntityList<Item> {...BASE} items={ITEMS} onOpen={() => {}} noun={{ one: 'item', many: 'items' }} />,
    );
    expect(screen.getByText('3 of 3 items')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('double-click to pin');
  });

  it('loading, error and nothing-at-all each have ONE spelling', () => {
    const { unmount } = render(<EntityList<Item> {...BASE} items={[]} loading />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    unmount();

    const errored = render(<EntityList<Item> {...BASE} items={[]} error="the server said no" />);
    expect(screen.getByText('the server said no')).toBeInTheDocument();
    errored.unmount();

    render(<EntityList<Item> {...BASE} items={[]} emptyText="No produce yet." />);
    expect(screen.getByText('No produce yet.')).toBeInTheDocument();
  });

  it('embedded lists leave the scrolling to whatever they sit in', () => {
    const { container } = render(<EntityList<Item> {...BASE} variant="embedded" items={ITEMS} />);
    expect(container.querySelector('.overflow-y-auto')).toBeNull();
    expect(list().className).not.toContain('overflow-y-auto');
  });
});
