/**
 * An interface's CONTRACT — the CALLING INTERFACE, and only that.
 *
 * SCOPE RULE: this view carries what someone driving the system needs in order to
 * call it — the full grammar of every command in the tree and each command's
 * input/output — and nothing else. The io is STRUCTURED FACTS, and a fact is ONE
 * LINE: the thing itself (a marker, a row template, an exit status, a path, a
 * question, a variable) and, after a `·`, the one condition it holds under. No table, no
 * column headers, no box — a fact list is not tabular data, it is a list of
 * sentences with the prose already removed, so it reads top to bottom at a
 * glance. A fact with no condition simply ends.
 *
 * The page reads ONCE, top to bottom: the pane's name and entry, the step
 * diagram, then here the grammar, the positionals, the question sequence (for an
 * interactive command) and the input/output facts. Nothing
 * repeats what the reader has already passed — the command path is
 * printed only where it says WHICH command of a tree is open, never as an echo of
 * the interface title.
 *
 * Two rules the whole block obeys:
 *
 *  - **Absence and "none" are different reads, always.** A list the derivation
 *    established as EMPTY says "none" out loud; a list it never established
 *    renders nothing at all. Papering over that gap with a confident "none" is
 *    how a scenario ends up asserting a promise nobody ever made.
 *  - **`unknown` is a first-class value.** An exit status the extraction and its
 *    probes could not settle wears the unknown badge, never a plausible 0/1.
 *  - **Nothing here is identity.** The contract is display of what the catalog
 *    carries; it never feeds a fingerprint, so it can grow without moving an
 *    interface or re-authoring a scenario.
 *
 * The command list is the tab's second nav, and it runs on the SAME tab model the
 * interface rows do ({@link useGuardCommandTabs} over `?gcmd=`): single-click
 * previews, double-click pins, and either way the selection is addressable — a
 * deep link lands on the command it names. The URL binding arrives as a prop, so
 * this component (like the pane around it) stays pure.
 */

import { FileQuestion, Pin } from 'lucide-react';
import {
  INTERFACE_UNKNOWN,
  type GuardInterfaceRow,
  type InterfaceCommandContract,
  type InterfaceConsumes,
  type InterfaceEnvFact,
  type InterfaceExitFact,
  type InterfaceOption,
  type InterfaceOutputFact,
  type InterfaceProduces,
  type InterfacePromptFact,
  type InterfacePromptSubmit,
  type InterfaceReadFact,
  type InterfaceRowFact,
  type InterfaceRowSlot,
  type InterfaceSequence,
  type InterfaceSequenceBranch,
  type InterfaceSequenceNode,
  type InterfaceWriteFact,
} from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityList } from '@/components/ui/entity-list';
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
function optionValue(option: InterfaceOption): string {
  if (!option.takesValue) return 'no value';
  const hint = option.valueHint ? ` <${option.valueHint}>` : '';
  return `${option.valueRequired ? 'required' : 'optional'}${hint}`;
}

function GrammarTable({ options }: { options: InterfaceOption[] }) {
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

function PositionalsTable({ command }: { command: InterfaceCommandContract }) {
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

/**
 * The condition, trailing its fact behind a `·`. A fact the derivation recorded
 * WITHOUT one holds unconditionally and simply ends — inventing an "always" for it
 * would state something the artifact never established.
 */
function When({ when }: { when?: string }) {
  if (!when) return null;
  return (
    <>
      <span aria-hidden="true" className="text-muted-foreground">
        ·
      </span>
      <span className="text-muted-foreground">{when}</span>
    </>
  );
}

/** Facts as flat rows: hairline-separated lines, never a box and never a table. */
function FactList({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-border/60">{children}</ul>;
}

/** One fact, one line — the chip (when the kind has one), the fact, the `when`. */
const ROW = 'flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 py-1 text-[11px] text-foreground';
const FACT = 'min-w-0 break-all font-mono';

function OutputFacts({ facts }: { facts: InterfaceOutputFact[] }) {
  return (
    <FactList>
      {facts.map((fact, i) => (
        <li key={i} className={ROW}>
          <span className={CHIP}>{fact.stream}</span>
          <span className={FACT}>{fact.marker}</span>
          <When when={fact.when} />
        </li>
      ))}
    </FactList>
  );
}

/** What a slot may hold, in the words the vocabulary is defined in. */
function slotHelp(slot: InterfaceRowSlot): string {
  if (slot.kind === 'count') return 'A count — an integer the program renders here.';
  if (slot.kind === 'enum') return `One of: ${slot.values?.join(' | ') ?? ''}`;
  return 'Text the program renders here — a name, a title, or a list it formats itself.';
}

/**
 * The template with its slots VISIBLE: the literal text exactly as the program
 * prints it, every `<slot>` marked and carrying its own value vocabulary. Neither
 * half stands alone — a template without its slots is a line no run ever prints,
 * and a vocabulary away from its template has nothing to fill.
 */
function Template({ fact }: { fact: InterfaceRowFact }) {
  const slots = new Map(fact.slots.map((slot) => [slot.name, slot]));
  return (
    <span className={FACT}>
      {fact.template.split(/(<[^<>]*>)/).map((part, i) => {
        const slot = part.startsWith('<') && part.endsWith('>') ? slots.get(part.slice(1, -1)) : undefined;
        if (!slot) return <span key={i}>{part}</span>;
        return (
          <HoverPopover key={i} portal width="narrow" content={slotHelp(slot)}>
            <span className="rounded bg-muted px-0.5 text-foreground">{part}</span>
          </HoverPopover>
        );
      })}
    </span>
  );
}

/**
 * The shape of a line of enumerated output — where it sits, and the template a
 * run fills in. It sits beside the output markers rather than replacing them: a
 * marker is the substring a scenario matches on, a template is the grammar around
 * it, and a scenario reading values off a listing needs both.
 */
function RowFacts({ facts }: { facts: InterfaceRowFact[] }) {
  return (
    <FactList>
      {facts.map((fact, i) => (
        <li key={i} className={ROW}>
          <span className={CHIP}>{fact.stream}</span>
          <HoverPopover portal width="narrow" content={ROLE_HELP[fact.role]}>
            <span className={CHIP}>{fact.role}</span>
          </HoverPopover>
          <Template fact={fact} />
          <When when={fact.when} />
        </li>
      ))}
    </FactList>
  );
}

const ROLE_HELP: Record<InterfaceRowFact['role'], string> = {
  header: 'Printed once, before the rows.',
  row: 'Printed once per item — this is the line that repeats.',
  footer: 'Printed once, after the rows.',
};

/**
 * The exit statuses, `unknown` included. An unsettled status is the honest output
 * of a derivation that could not establish it — shown as `unknown` with what IS
 * known beside it, never rounded to a plausible number.
 */
function ExitFacts({ facts }: { facts: InterfaceExitFact[] }) {
  return (
    <FactList>
      {facts.map((fact, i) => (
        <li key={i} className={ROW}>
          {fact.exit === INTERFACE_UNKNOWN ? (
            <HoverPopover
              portal
              width="narrow"
              content="Neither the extraction nor a probe established this status. Recorded as unknown rather than guessed — a scenario must not assert it."
            >
              <span className="rounded border border-slate-400/60 px-1 py-px font-mono text-[10px] text-muted-foreground">
                {INTERFACE_UNKNOWN}
              </span>
            </HoverPopover>
          ) : (
            <span className="rounded bg-muted px-1 py-px font-mono text-[10px] text-foreground">{fact.exit}</span>
          )}
          <When when={fact.when} />
        </li>
      ))}
    </FactList>
  );
}

function WriteFacts({ facts }: { facts: InterfaceWriteFact[] }) {
  return (
    <FactList>
      {facts.map((fact, i) => (
        <li key={i} className={ROW}>
          <span className={FACT}>{fact.path}</span>
          <When when={fact.when} />
        </li>
      ))}
    </FactList>
  );
}

/** How the answer is delivered — the one thing a scripted TTY answer must get right. */
const SUBMIT_HELP: Record<InterfacePromptSubmit, string> = {
  enter: 'The answer is typed, then submitted with the Enter key — a select menu, a text or password prompt.',
  char: 'A single printable keypress IS the answer and submits it, with no Enter — a y/n confirm.',
};

function PromptFacts({ facts }: { facts: InterfacePromptFact[] }) {
  return (
    <FactList>
      {facts.map((fact, i) => (
        <li key={i} className={ROW}>
          <span className={CHIP}>{fact.kind}</span>
          <span className={FACT}>{`“${fact.marker}”`}</span>
          {fact.answerHint ? (
            <span className="text-muted-foreground">
              answers: <span className="font-mono">{fact.answerHint}</span>
            </span>
          ) : null}
          {fact.submit ? (
            <HoverPopover portal width="narrow" content={SUBMIT_HELP[fact.submit]}>
              <span className={CHIP}>submit: {fact.submit}</span>
            </HoverPopover>
          ) : null}
          <When when={fact.when} />
        </li>
      ))}
    </FactList>
  );
}

/**
 * The QUESTION SEQUENCE — the dialogue an interactive command runs, in the order
 * it runs it. It is the one block on this page that is not a fact list: the
 * prompts below say WHAT each question is, this says WHEN it arrives and which
 * earlier answer reveals it, which together are everything a scripted answer set
 * needs. Consecutive questions that share a condition sit under ONE short label,
 * so the branch reads as a branch instead of the same sentence three times.
 */
function sequenceGroups(nodes: InterfaceSequenceNode[]): { after?: InterfaceSequenceBranch; nodes: InterfaceSequenceNode[] }[] {
  const groups: { after?: InterfaceSequenceBranch; nodes: InterfaceSequenceNode[] }[] = [];
  for (const node of nodes) {
    const last = groups[groups.length - 1];
    const same =
      last &&
      last.after?.prompt === node.after?.prompt &&
      last.after?.answer === node.after?.answer;
    if (same) last.nodes.push(node);
    else groups.push({ ...(node.after ? { after: node.after } : {}), nodes: [node] });
  }
  return groups;
}

/** One question of the dialogue: how it is answered, the question, whether it loops. */
function Question({ node }: { node: InterfaceSequenceNode }) {
  return (
    <li className={ROW}>
      <span className={CHIP}>{node.kind}</span>
      <span className={FACT}>{`“${node.prompt}”`}</span>
      {node.repeats ? (
        <>
          <HoverPopover portal width="narrow" content="Asked again on the same run — a scripted answer set needs one answer per pass.">
            <span className={CHIP}>repeats</span>
          </HoverPopover>
          <span className="text-muted-foreground">{node.repeats}</span>
        </>
      ) : null}
    </li>
  );
}

function SequenceList({ sequence }: { sequence: InterfaceSequence }) {
  if (sequence === INTERFACE_UNKNOWN) {
    return (
      <HoverPopover
        portal
        width="narrow"
        content="The order these questions arrive in was not established. Recorded as unknown rather than guessed — the mapper still owes it, and an invented order scripts a scenario into a hang."
      >
        <p className="inline-block py-1 text-[11px] italic text-muted-foreground">sequence unknown</p>
      </HoverPopover>
    );
  }
  return (
    <ol className="divide-y divide-border/60">
      {sequenceGroups(sequence).map((group, i) =>
        group.after ? (
          <li key={i} className="py-1">
            <div className="text-[10px] text-muted-foreground">
              {`only after “${group.after.prompt}” = ${group.after.answer}`}
            </div>
            <ol className="mt-0.5 border-l border-border pl-2">
              {group.nodes.map((node) => (
                <Question key={node.prompt} node={node} />
              ))}
            </ol>
          </li>
        ) : (
          group.nodes.map((node) => <Question key={node.prompt} node={node} />)
        ),
      )}
    </ol>
  );
}

function EnvFacts({ facts }: { facts: InterfaceEnvFact[] }) {
  return (
    <FactList>
      {facts.map((fact, i) => (
        <li key={i} className={ROW}>
          <span className={FACT}>{fact.var}</span>
          <When when={fact.when} />
        </li>
      ))}
    </FactList>
  );
}

/** The read side of the file contract — what a scenario has to put there first. */
function ReadFacts({ facts }: { facts: InterfaceReadFact[] }) {
  return (
    <FactList>
      {facts.map((fact, i) => (
        <li key={i} className={ROW}>
          <span className={FACT}>{fact.path}</span>
          <When when={fact.when} />
        </li>
      ))}
    </FactList>
  );
}

/**
 * One block of a panel: its heading and its facts. A list the derivation never
 * established renders nothing — heading included; an EMPTY one it did establish
 * says "none" out loud.
 */
function Block<T>({
  title,
  list,
  children,
}: {
  title: string;
  list: T[] | undefined;
  children: (list: T[]) => React.ReactNode;
}) {
  if (list === undefined) return null;
  return (
    <div className="mt-2 first:mt-0">
      <div className={`${SUBLABEL} mb-1`}>{title}</div>
      {list.length === 0 ? <NoneLine /> : children(list)}
    </div>
  );
}

function ConsumesPanel({ consumes }: { consumes: InterfaceConsumes }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-foreground">Consumes</div>
      <Block title="Prompts" list={consumes.prompts}>
        {(prompts) => <PromptFacts facts={prompts} />}
      </Block>
      <Block title="Environment" list={consumes.env}>
        {(env) => <EnvFacts facts={env} />}
      </Block>
      <Block title="Reads" list={consumes.reads}>
        {(reads) => <ReadFacts facts={reads} />}
      </Block>
    </div>
  );
}

function ProducesPanel({ produces }: { produces: InterfaceProduces }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-foreground">Produces</div>
      <Block title="Output" list={produces.output}>
        {(output) => <OutputFacts facts={output} />}
      </Block>
      <Block title="Row shapes" list={produces.rows}>
        {(rows) => <RowFacts facts={rows} />}
      </Block>
      <Block title="Exit codes" list={produces.exits}>
        {(exits) => <ExitFacts facts={exits} />}
      </Block>
      <Block title="Writes" list={produces.writes}>
        {(writes) => <WriteFacts facts={writes} />}
      </Block>
    </div>
  );
}

function CommandContract({ command, showPath }: { command: InterfaceCommandContract; showPath: boolean }) {
  const { consumes, produces } = command.io ?? {};

  return (
    <div>
      {/* Only a TREE needs to say which command is open; on a one-command interface
          the path is the interface title the reader just passed. */}
      {showPath ? (
        <div className="font-mono text-[12px] text-foreground">{command.path.join(' ')}</div>
      ) : null}
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

      {/* The dialogue before the facts it orders: read it and you can script the
          answers, then read the prompt facts below for what each question is. */}
      {command.sequence !== undefined ? (
        <Section title="Question sequence">
          <SequenceList sequence={command.sequence} />
        </Section>
      ) : null}

      {consumes || produces ? (
        <Section title="Input and output">
          <div className="grid gap-x-6 gap-y-3 lg:grid-cols-2">
            {consumes ? <ConsumesPanel consumes={consumes} /> : null}
            {produces ? <ProducesPanel produces={produces} /> : null}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

/**
 * The command nav: single-click previews, double-click pins — both addressable.
 * The shared {@link EntityList} embedded in the contract card, so this nav reads
 * and behaves exactly like every other list in the product.
 */
function CommandNav({
  commands,
  activeKey,
  tabs,
}: {
  commands: InterfaceCommandContract[];
  activeKey: string;
  tabs: GuardTabsState;
}) {
  return (
    <EntityList<InterfaceCommandContract>
      variant="embedded"
      label="Commands"
      items={commands}
      itemId={(command) => command.path.join(' ')}
      activeId={activeKey}
      onOpen={(id, pinned) => tabs.open(id, pinned)}
      renderRow={(command) => {
        const key = command.path.join(' ');
        const pinned = tabs.openTabs.some((tab) => tab.id === key && tab.pinned);
        return (
          <div className="flex w-full items-center gap-2">
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
            <span className="shrink-0 text-[10px] text-muted-foreground">{command.options?.length ?? 0} flags</span>
          </div>
        );
      }}
    />
  );
}

export function GuardInterfaceContract({ iface, tabs }: { iface: GuardInterfaceRow; tabs: GuardTabsState }) {
  const commands = iface.contract?.commands ?? [];
  const keys = commands.map((command) => command.path.join(' '));
  // The selected command, or the first one. A `?gcmd` naming another interface's
  // command simply doesn't match here — no empty pane, no cross-interface bleed.
  const activeKey = (tabs.activeId && keys.includes(tabs.activeId) ? tabs.activeId : keys[0]) ?? '';
  const active = commands.find((command) => command.path.join(' ') === activeKey) ?? null;

  if (!iface.contract) {
    return (
      <Section title="Contract">
        <div className="rounded border border-border py-6">
          <EmptyState
            icon={FileQuestion}
            title="No contract derived"
            body="The mapper derives it; nothing is filled in on its behalf."
          />
        </div>
      </Section>
    );
  }

  const isTree = commands.length > 1;

  return (
    <div>
      {isTree ? (
        <Section title="Commands">
          <div className="rounded border border-border">
            <CommandNav commands={commands} activeKey={activeKey} tabs={tabs} />
          </div>
        </Section>
      ) : null}

      {active ? (
        <div className={isTree ? 'mt-3' : ''}>
          <CommandContract command={active} showPath={isTree} />
        </div>
      ) : null}
    </div>
  );
}
