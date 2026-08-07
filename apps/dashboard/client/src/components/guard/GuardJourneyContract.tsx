/**
 * A journey's CONTRACT — the read surface for "what does this command take, and
 * what does it give back". The sequence diagram above it says which command a
 * scenario walks; this says everything a caller (or a scenario author) needs to
 * drive it: the full grammar of every command in the tree, and each command's
 * input/output.
 *
 * Three rules the whole block obeys:
 *
 *  - **Absence and "none" are different reads, always.** A list the derivation
 *    established as EMPTY says "none" out loud; a list it never established
 *    renders nothing at all. Papering over that gap with a confident "none" is
 *    how a scenario ends up asserting a promise nobody ever made.
 *  - **`unknown` is a first-class value.** An exit code the extraction and its
 *    probes could not settle wears the unknown badge, never a plausible 0/1.
 *  - **Nothing here is identity.** The contract is display of what the catalog
 *    carries; it never feeds a fingerprint, so it can grow without moving a
 *    journey or re-authoring a scenario.
 *
 * The command list is the tab's second nav, and it runs on the SAME tab model the
 * journey rows do ({@link useGuardCommandTabs} over `?gcmd=`): single-click
 * previews, double-click pins, and either way the selection is addressable — a
 * deep link lands on the command it names. The URL binding arrives as a prop, so
 * this component (like the pane around it) stays pure.
 */

import { FileQuestion, Pin, Terminal } from 'lucide-react';
import {
  JOURNEY_UNKNOWN,
  type GuardJourneyRow,
  type JourneyCommandContract,
  type JourneyConsumes,
  type JourneyDiagnostic,
  type JourneyExitCode,
  type JourneyIoRead,
  type JourneyIoWrite,
  type JourneyOption,
  type JourneyOutput,
  type JourneyProduces,
  type JourneyPrompt,
  type JourneySharedContract,
  type JourneySharedRef,
} from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import type { GuardTabsState } from '@/hooks/useGuardTabs';

const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';
const SUBLABEL = 'text-[10px] font-medium uppercase tracking-wider text-muted-foreground';
const CELL = 'px-2 py-1 align-top text-[11px] text-foreground';
const HEAD = 'px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground';
const CHIP = 'inline-flex items-center gap-1 rounded border border-border px-1 py-px text-[10px] text-muted-foreground';

/** The one honest rendering of a list the derivation left unestablished: nothing. */
function Established({ list, children }: { list: unknown[] | undefined; children: React.ReactNode }) {
  if (list === undefined) return null;
  return <>{children}</>;
}

/**
 * "none" — an EMPTY list the derivation established, said out loud under its own
 * heading. The heading is always right there, so the word alone is the whole
 * sentence; what it must never do is look like the heading was simply omitted.
 */
function NoneLine() {
  return <p className="py-1 text-[11px] italic text-muted-foreground">none</p>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className={LABEL}>{title}</div>
      {children}
    </div>
  );
}

/** A table that scrolls sideways INSIDE its own box — the pane never does. */
function Scroller({ children }: { children: React.ReactNode }) {
  return <div className="max-w-full overflow-x-auto rounded border border-border">{children}</div>;
}

/** How the flag takes its value, in words rather than two booleans. */
function optionValue(option: JourneyOption): string {
  if (!option.takesValue) return 'no value';
  const hint = option.valueHint ? ` <${option.valueHint}>` : '';
  return `${option.valueRequired ? 'required' : 'optional'}${hint}`;
}

function GrammarTable({ options }: { options: JourneyOption[] }) {
  return (
    <Scroller>
      <table className="w-full border-collapse">
        <thead className="border-b border-border bg-muted/30">
          <tr>
            <th className={HEAD}>Flag</th>
            <th className={HEAD}>Value</th>
            <th className={HEAD}>Choices</th>
            <th className={HEAD}>Default</th>
            <th className={HEAD}>Where</th>
            <th className={HEAD}>What it does</th>
          </tr>
        </thead>
        <tbody>
          {options.map((option) => (
            <tr key={`${option.flag}-${option.short ?? ''}`} className="border-b border-border/60 last:border-0">
              <td className={`${CELL} whitespace-nowrap font-mono`}>
                {option.flag}
                {option.short ? <span className="text-muted-foreground">, {option.short}</span> : null}
                {option.hidden ? (
                  <HoverPopover portal width="narrow" content="Registered, but withheld from the help output.">
                    <span className={`ml-1 ${CHIP}`}>hidden</span>
                  </HoverPopover>
                ) : null}
              </td>
              <td className={`${CELL} whitespace-nowrap text-muted-foreground`}>{optionValue(option)}</td>
              <td className={CELL}>
                {option.choices?.length ? (
                  <span className="font-mono text-[10px] text-foreground">{option.choices.join(' | ')}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className={`${CELL} whitespace-nowrap font-mono`}>
                {option.default === undefined ? (
                  <span className="font-sans text-muted-foreground">—</span>
                ) : (
                  String(option.default)
                )}
              </td>
              <td className={`${CELL} whitespace-nowrap`}>
                {option.scope === 'program' ? (
                  <HoverPopover portal width="narrow" content="A program-level flag — pass it before the subcommand.">
                    <span className={CHIP}>program</span>
                  </HoverPopover>
                ) : (
                  <span className="text-muted-foreground">{option.scope ?? '—'}</span>
                )}
              </td>
              <td className={`${CELL} text-muted-foreground`}>{option.description ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroller>
  );
}

function PositionalsTable({ command }: { command: JourneyCommandContract }) {
  if (command.positionals === undefined) return null;
  if (command.positionals.length === 0) return <NoneLine />;
  return (
    <Scroller>
      <table className="w-full border-collapse">
        <thead className="border-b border-border bg-muted/30">
          <tr>
            <th className={HEAD}>Argument</th>
            <th className={HEAD}>Required</th>
            <th className={HEAD}>What it is</th>
          </tr>
        </thead>
        <tbody>
          {command.positionals.map((positional) => (
            <tr key={positional.name} className="border-b border-border/60 last:border-0">
              <td className={`${CELL} whitespace-nowrap font-mono`}>
                {positional.name}
                {positional.variadic ? <span className={`ml-1 ${CHIP}`}>variadic</span> : null}
              </td>
              <td className={`${CELL} whitespace-nowrap text-muted-foreground`}>
                {positional.required ? 'required' : 'optional'}
              </td>
              <td className={`${CELL} text-muted-foreground`}>{positional.description ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroller>
  );
}

function Fact({ head, body, mono }: { head: string; body?: string; mono?: boolean }) {
  return (
    <li className="border-b border-border/40 py-1 last:border-0">
      <span className={`${mono ? 'font-mono' : ''} text-[11px] text-foreground`}>{head}</span>
      {body ? <span className="text-[11px] text-muted-foreground"> — {body}</span> : null}
    </li>
  );
}

function Prompts({ prompts }: { prompts: JourneyPrompt[] }) {
  if (prompts.length === 0) return <NoneLine />;
  return (
    <ul className="mt-0.5">
      {prompts.map((prompt, i) => (
        <li key={`${prompt.name}-${i}`} className="border-b border-border/40 py-1 last:border-0">
          <span className="text-[11px] text-foreground">
            {prompt.name === 'none' ? 'never asks anything' : prompt.name}
          </span>
          {prompt.when ? <span className="text-[11px] text-muted-foreground"> — {prompt.when}</span> : null}
          {prompt.prompts?.length ? (
            <ul className="mt-0.5 space-y-0.5">
              {prompt.prompts.map((question, q) => (
                <li key={q} className="pl-3 text-[11px] text-muted-foreground">
                  “{question}”
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Reads({ reads }: { reads: JourneyIoRead[] }) {
  if (reads.length === 0) return <NoneLine />;
  return (
    <ul className="mt-0.5">
      {reads.map((read, i) => (
        <Fact key={`${read.path}-${i}`} head={read.path} body={read.as} mono />
      ))}
    </ul>
  );
}

function Writes({ writes }: { writes: JourneyIoWrite[] }) {
  if (writes.length === 0) return <NoneLine />;
  return (
    <ul className="mt-0.5">
      {writes.map((write, i) => (
        <Fact
          key={`${write.path}-${i}`}
          head={write.path}
          body={[write.when, write.content, write.note].filter(Boolean).join(' · ')}
          mono
        />
      ))}
    </ul>
  );
}

function Outputs({ outputs, stream }: { outputs: JourneyOutput[]; stream: string }) {
  if (outputs.length === 0) return <NoneLine />;
  return (
    <ul className="mt-0.5">
      {outputs.map((output, i) => (
        <Fact key={i} head={output.shape} body={[output.when, output.content].filter(Boolean).join(' · ')} />
      ))}
    </ul>
  );
}

/**
 * The exit statuses, `unknown` included. An unestablished code is the honest
 * output of a derivation that could not settle it — it is shown as `unknown`
 * with what IS known beside it, never rounded to a plausible number.
 */
function ExitCodes({ codes }: { codes: JourneyExitCode[] }) {
  if (codes.length === 0) return <NoneLine />;
  return (
    <ul className="mt-0.5">
      {codes.map((code, i) => {
        const unknown = code.code === JOURNEY_UNKNOWN;
        return (
          <li key={`${code.code}-${i}`} className="flex items-baseline gap-2 border-b border-border/40 py-1 last:border-0">
            {unknown ? (
              <HoverPopover
                portal
                width="narrow"
                content="Neither the extraction nor a probe established this status. Recorded as unknown rather than guessed — a scenario must not assert it."
              >
                <span className="shrink-0 rounded border border-amber-500/60 px-1 py-px font-mono text-[10px] text-amber-600 dark:text-amber-400">
                  {JOURNEY_UNKNOWN}
                </span>
              </HoverPopover>
            ) : (
              <span className="shrink-0 rounded bg-muted px-1 py-px font-mono text-[10px] text-foreground">
                {code.code}
              </span>
            )}
            <span className="min-w-0 text-[11px] text-muted-foreground">{code.means}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Strings({ items, what }: { items: string[]; what: string }) {
  if (items.length === 0) return <NoneLine />;
  return (
    <ul className="mt-0.5">
      {items.map((item, i) => (
        <Fact key={i} head={item} />
      ))}
    </ul>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 first:mt-0">
      <div className={SUBLABEL}>{title}</div>
      {children}
    </div>
  );
}

function SharedRefs({ refs }: { refs: JourneySharedRef[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {refs.map((ref, i) => (
        <HoverPopover
          key={`${ref.block}-${i}`}
          portal
          width="narrow"
          content={`The journey's shared ${ref.block} applies to this command too — see “Shared across every command” below.`}
        >
          <span className={CHIP}>
            + shared {ref.block}
            {ref.note ? <span className="text-foreground">· {ref.note}</span> : null}
          </span>
        </HoverPopover>
      ))}
    </div>
  );
}

function ConsumesPanel({ consumes }: { consumes: JourneyConsumes }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="mb-1 text-[11px] font-semibold text-foreground">Consumes</div>
      {consumes.positionalsNote ? (
        <p className="text-[11px] text-muted-foreground">Arguments: {consumes.positionalsNote}</p>
      ) : null}
      {consumes.flagsNote ? <p className="text-[11px] text-muted-foreground">Flags: {consumes.flagsNote}</p> : null}
      <Established list={consumes.stdin}>
        <Block title="Stdin">
          <Prompts prompts={consumes.stdin ?? []} />
        </Block>
      </Established>
      <Established list={consumes.reads}>
        <Block title="Reads">
          <Reads reads={consumes.reads ?? []} />
        </Block>
      </Established>
      <Established list={consumes.environment}>
        <Block title="Environment">
          <Strings items={consumes.environment ?? []} what="Environment" />
        </Block>
      </Established>
    </div>
  );
}

function ProducesPanel({ produces }: { produces: JourneyProduces }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="mb-1 text-[11px] font-semibold text-foreground">Produces</div>
      <Established list={produces.stdout}>
        <Block title="Stdout">
          <Outputs outputs={produces.stdout ?? []} stream="Stdout" />
        </Block>
      </Established>
      <Established list={produces.stderr}>
        <Block title="Stderr">
          <Outputs outputs={produces.stderr ?? []} stream="Stderr" />
        </Block>
      </Established>
      <Established list={produces.writes}>
        <Block title="Writes">
          <Writes writes={produces.writes ?? []} />
        </Block>
      </Established>
      <Established list={produces.exitCodes}>
        <Block title="Exit codes">
          <ExitCodes codes={produces.exitCodes ?? []} />
        </Block>
      </Established>
      <Established list={produces.sideEffects}>
        <Block title="Side effects">
          <Strings items={produces.sideEffects ?? []} what="Side effects" />
        </Block>
      </Established>
    </div>
  );
}

function CommandContract({ command }: { command: JourneyCommandContract }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-[12px] text-foreground">{command.path.join(' ')}</span>
        {command.subcommands?.length ? (
          <HoverPopover portal width="narrow" content="Subcommands this command registers, in registration order.">
            <span className={CHIP}>{command.subcommands.length} subcommands</span>
          </HoverPopover>
        ) : null}
      </div>
      {command.description ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{command.description}</p>
      ) : null}
      {command.subcommands?.length ? (
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">{command.subcommands.join(' · ')}</p>
      ) : null}

      <Established list={command.options}>
        <Section title="Grammar">
          {command.options?.length ? <GrammarTable options={command.options} /> : <NoneLine />}
        </Section>
      </Established>

      <Established list={command.positionals}>
        <Section title="Positional arguments">
          <PositionalsTable command={command} />
        </Section>
      </Established>

      {command.io ? (
        <Section title="Input and output">
          <div className="grid gap-2 lg:grid-cols-2">
            {command.io.consumes ? <ConsumesPanel consumes={command.io.consumes} /> : null}
            {command.io.produces ? <ProducesPanel produces={command.io.produces} /> : null}
          </div>
          {command.inheritsShared?.length ? <SharedRefs refs={command.inheritsShared} /> : null}
        </Section>
      ) : null}

      <Established list={command.notes}>
        <Section title="Behavior notes">
          <ul className="space-y-1">
            {(command.notes ?? []).map((note, i) => (
              <li key={i} className="text-[11px] text-muted-foreground">
                {note}
              </li>
            ))}
          </ul>
        </Section>
      </Established>
    </div>
  );
}

function SharedPanel({ shared }: { shared: JourneySharedContract }) {
  return (
    <Section title="Shared across every command">
      <div className="rounded border border-border p-2">
        {shared.note ? <p className="mb-1 text-[11px] text-muted-foreground">{shared.note}</p> : null}
        <Established list={shared.stdin}>
          <Block title="Stdin">
            <Prompts prompts={shared.stdin ?? []} />
          </Block>
        </Established>
        <Established list={shared.reads}>
          <Block title="Reads">
            <Reads reads={shared.reads ?? []} />
          </Block>
        </Established>
        <Established list={shared.writes}>
          <Block title="Writes">
            <Writes writes={shared.writes ?? []} />
          </Block>
        </Established>
        <Established list={shared.exitCodes}>
          <Block title="Exit codes">
            <ExitCodes codes={shared.exitCodes ?? []} />
          </Block>
        </Established>
        <Established list={shared.environment}>
          <Block title="Environment">
            <Strings items={shared.environment ?? []} what="Environment" />
          </Block>
        </Established>
        <Established list={shared.enumerations}>
          <Block title="Value sets">
            <ul className="mt-0.5">
              {(shared.enumerations ?? []).map((set) => (
                <Fact key={set.name} head={set.name} body={`${set.values.join(', ')}${set.note ? ` · ${set.note}` : ''}`} />
              ))}
            </ul>
          </Block>
        </Established>
        <Established list={shared.files}>
          <Block title="State files">
            <ul className="mt-0.5">
              {(shared.files ?? []).map((file) => (
                <li key={file.path} className="border-b border-border/40 py-1 last:border-0">
                  <span className="font-mono text-[11px] text-foreground">{file.path}</span>
                  {file.keys?.length ? (
                    <ul className="mt-0.5 space-y-0.5">
                      {file.keys.map((key, k) => (
                        <li key={k} className="pl-3 font-mono text-[11px] text-muted-foreground">
                          {key}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {file.note ? <p className="text-[11px] text-muted-foreground">{file.note}</p> : null}
                </li>
              ))}
            </ul>
          </Block>
        </Established>
        <Established list={shared.notes}>
          <Block title="Rules">
            <ul className="mt-0.5 space-y-1">
              {(shared.notes ?? []).map((note, i) => (
                <li key={i} className="text-[11px] text-muted-foreground">
                  {note}
                </li>
              ))}
            </ul>
          </Block>
        </Established>
      </div>
    </Section>
  );
}

/**
 * The doc-versus-code feed. A finding that says the two sides AGREE is as much a
 * result as one that says they don't — it is the only evidence that the pair was
 * actually compared — so agreements read green and disagreements amber, and
 * neither is hidden.
 */
function Diagnostics({ diagnostics }: { diagnostics: JourneyDiagnostic[] }) {
  return (
    <Section title="Doc-versus-code findings">
      <ul className="space-y-1">
        {diagnostics.map((diagnostic, i) => {
          const agrees = diagnostic.right?.startsWith('both agree') ?? false;
          return (
            <li key={`${diagnostic.kind}-${i}`} className="rounded border border-border p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded border px-1 py-px text-[10px] ${
                    agrees
                      ? 'border-emerald-500/60 text-emerald-600 dark:text-emerald-400'
                      : 'border-amber-500/60 text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {diagnostic.kind}
                </span>
                <span className="font-mono text-[11px] text-foreground">{diagnostic.subject}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{diagnostic.detail}</p>
              {diagnostic.right ? (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  <span className={SUBLABEL}>right</span> · {diagnostic.right}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** The command nav: single-click previews, double-click pins — both addressable. */
function CommandNav({
  commands,
  activeKey,
  tabs,
}: {
  commands: JourneyCommandContract[];
  activeKey: string;
  tabs: GuardTabsState;
}) {
  return (
    <div className="flex flex-col" role="list" aria-label="Commands">
      {commands.map((command) => {
        const key = command.path.join(' ');
        const pinned = tabs.openTabs.some((tab) => tab.id === key && tab.pinned);
        return (
          <button
            key={key}
            type="button"
            role="listitem"
            onClick={() => tabs.open(key, false)}
            onDoubleClick={() => tabs.open(key, true)}
            className={`flex w-full items-center gap-2 border-b border-border/60 px-2 py-1 text-left transition-colors ${
              activeKey === key ? 'bg-primary/10' : 'hover:bg-muted/40'
            }`}
          >
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{key}</span>
            {pinned ? (
              <HoverPopover
                portal
                width="narrow"
                content="Pinned — the command rides in the URL, so a reload or a shared link lands back here."
              >
                <Pin aria-label={`${key} pinned`} className="h-3 w-3 shrink-0 text-muted-foreground" />
              </HoverPopover>
            ) : null}
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {command.options?.length ?? 0} flags
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function GuardJourneyContract({ journey, tabs }: { journey: GuardJourneyRow; tabs: GuardTabsState }) {
  const commands = journey.contract?.commands ?? [];
  const keys = commands.map((command) => command.path.join(' '));
  // The selected command, or the first one. A `?gcmd` naming another journey's
  // command simply doesn't match here — no empty pane, no cross-journey bleed.
  const activeKey = (tabs.activeId && keys.includes(tabs.activeId) ? tabs.activeId : keys[0]) ?? '';
  const active = commands.find((command) => command.path.join(' ') === activeKey) ?? null;

  if (!journey.contract) {
    return (
      <Section title="Contract">
        <div className="rounded border border-border py-6">
          <EmptyState
            icon={FileQuestion}
            title="No contract derived"
            body="This catalog carries the command tree only. The grammar and the input/output contract appear here once the mapper derives them — nothing is filled in on their behalf."
          />
        </div>
      </Section>
    );
  }

  const { summary, derivedFrom, shared, decisions } = journey.contract;

  return (
    <div>
      <Section title="Contract">
        <div className="flex flex-wrap items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
          {summary ? <span className="text-[12px] text-foreground">{summary}</span> : null}
          {derivedFrom?.length ? (
            <HoverPopover
              portal
              width="wide"
              content={
                <span>
                  Where this contract came from:
                  {derivedFrom.map((source, i) => (
                    <span key={i} className="mt-1 block">
                      {source}
                    </span>
                  ))}
                </span>
              }
            >
              <span className={CHIP}>{derivedFrom.length} sources</span>
            </HoverPopover>
          ) : null}
        </div>

        {commands.length > 1 ? (
          <div className="mt-2 rounded border border-border">
            <CommandNav commands={commands} activeKey={activeKey} tabs={tabs} />
          </div>
        ) : null}
      </Section>

      {active ? (
        <div className="mt-3">
          <CommandContract command={active} />
        </div>
      ) : null}
      {shared ? <SharedPanel shared={shared} /> : null}

      <Established list={decisions}>
        <Section title="Authored decisions">
          {decisions?.length === 0 ? (
            <NoneLine />
          ) : (
            <ul className="space-y-1">
              {(decisions ?? []).map((decision) => (
                <li key={decision.id} className="rounded border border-border p-2">
                  <div className="font-mono text-[11px] text-foreground">{decision.id}</div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{decision.decision}</p>
                  {decision.consequencesNotModeled?.length ? (
                    <>
                      <div className={`mt-1 ${SUBLABEL}`}>not modeled</div>
                      <ul className="space-y-0.5">
                        {decision.consequencesNotModeled.map((consequence, i) => (
                          <li key={i} className="text-[11px] text-muted-foreground">
                            {consequence}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </Established>

      {journey.diagnostics?.length ? <Diagnostics diagnostics={journey.diagnostics} /> : null}
    </div>
  );
}
