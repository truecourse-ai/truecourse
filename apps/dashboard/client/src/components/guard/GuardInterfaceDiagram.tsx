/**
 * An interface as a SEQUENCE DIAGRAM — participants across the top, dashed lifelines
 * beneath them, one labelled message per step (an `input` step is a self-message
 * box on its own lifeline). Rendered in the Interfaces-tab detail and in a
 * scenario's detail, where it shows the code path the scenario grounds on.
 *
 * Compact and self-contained (no canvas, no zoom chrome): the shape is derived by
 * `lib/guard-interface-diagram.ts`, so the renderer stays surface-agnostic.
 */

import { interfaceDiagramModel } from '@/lib/guard-interface-diagram';
import type { Interface } from '@truecourse/shared';

const CELL = 'text-[11px] font-mono text-muted-foreground';

export function GuardInterfaceDiagram({
  iface,
  label,
}: {
  iface: Pick<Interface, 'steps'> & Partial<Pick<Interface, 'type' | 'id'>>;
  /** Accessible name — defaults to the interface id. */
  label?: string;
}) {
  const { participants, messages } = interfaceDiagramModel(iface);
  const columns = { gridTemplateColumns: `repeat(${participants.length}, minmax(0, 1fr))` };

  return (
    <div
      className="rounded border border-border bg-card/40 p-3"
      role="group"
      aria-label={label ? `Interface ${label}` : 'Interface sequence'}
    >
      {/* Participants */}
      <div className="grid gap-2" style={columns}>
        {participants.map((p) => (
          <div
            key={p}
            className="truncate rounded border border-border bg-card px-2 py-1 text-center text-[11px] font-medium text-foreground"
          >
            {p}
          </div>
        ))}
      </div>

      {/* Lifelines + messages */}
      <div className="relative mt-1">
        <div className="pointer-events-none absolute inset-0 grid gap-2" style={columns} aria-hidden>
          {participants.map((p) => (
            <div key={p} className="flex justify-center">
              <span className="h-full border-l border-dashed border-muted-foreground/40" />
            </div>
          ))}
        </div>

        <div className="relative grid gap-y-2 py-2" style={columns}>
          {messages.map((m, i) => {
            const start = Math.min(m.from, m.to) + 1;
            const end = Math.max(m.from, m.to) + 2;
            const forward = m.to >= m.from;
            return (
              <div
                key={`${i}-${m.label}`}
                style={{ gridColumn: `${start} / ${end}`, gridRow: i + 1 }}
                className="min-w-0 px-1"
              >
                {m.from === m.to ? (
                  <div className={`truncate rounded border border-border bg-card px-2 py-0.5 text-center ${CELL}`}>
                    {m.label}
                  </div>
                ) : m.reply ? (
                  // A reply: the interaction change the action produced,
                  // flowing back to the user — prose on a dashed line.
                  <div className="flex flex-col items-center">
                    <span className="w-full truncate text-center text-[10px] italic leading-tight text-muted-foreground" title={m.label}>
                      {m.label}
                    </span>
                    <span className="flex w-full items-center text-muted-foreground/70">
                      {!forward && <span className="text-[10px] leading-none">◁</span>}
                      <span className="h-0 flex-1 border-t border-dashed border-muted-foreground/50" />
                      {forward && <span className="text-[10px] leading-none">▷</span>}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <span className={`w-full truncate text-center ${CELL}`} title={m.label}>{m.label}</span>
                    <span className="flex w-full items-center text-primary/70">
                      {!forward && <span className="text-[10px] leading-none">◀</span>}
                      <span className="h-px flex-1 bg-primary/40" />
                      {forward && <span className="text-[10px] leading-none">▶</span>}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
