import { useState } from 'react';

type Member = {
  readonly id: number;
  readonly priority: number;
  readonly active: boolean;
  readonly tag: string;
};

interface PanelProps {
  readonly members: Member[];
  readonly current: Member;
}

export function MemberPanel({ members, current }: PanelProps): JSX.Element {
  const [searchTerm] = useState('');

  // Single-stage .filter() on a regular array — O(n) and cheap. Wrapping in
  // useMemo would be over-engineering and should not be flagged.
  const subsequent = members.filter((m) => m.priority > current.priority);

  // Chained .map(...).filter(Boolean) — the trailing filter(Boolean) is the
  // standard null-removal idiom and should not be flagged.
  const validTags = members.map((m) => m.tag).filter(Boolean);

  const matches = members.filter((m) => m.id !== current.id);

  return (
    <div>
      <span>{searchTerm}</span>
      <span>{subsequent.length}</span>
      <span>{validTags.length}</span>
      <span>{matches.length}</span>
    </div>
  );
}
