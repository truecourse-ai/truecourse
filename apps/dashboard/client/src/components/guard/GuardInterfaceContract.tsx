/**
 * An interface's CONTRACT — the CALLING INTERFACE, and only that.
 *
 * SCOPE RULE: this view carries what someone driving the system needs in order to
 * call it — the invocable's full grammar and its input/output — and nothing else.
 * The io is STRUCTURED FACTS, and a fact is ONE LINE: the thing itself (a marker,
 * a row template, a status, a path, a question, a variable) and, after a `·`, the
 * one condition it holds under. No table, no column headers, no box — a fact list
 * is not tabular data, it is a list of sentences with the prose already removed,
 * so it reads top to bottom at a glance. A fact with no condition simply ends.
 *
 * It dispatches on the SURFACE. A cli entry gets the command grammar, its
 * positionals and (where it is interactive) its question sequence. An api entry
 * gets HTTP: its request split by where the caller puts it, its response
 * statuses, its response-body markers. That dispatch is the point of the contract
 * union — before it, an operation was rendered as a command whose argv was
 * `["GET", "/x"]`, its query parameters sat under a column headed "Flag" and its
 * 404 under a heading reading "Exit codes", and every one of those was a decoding
 * step the reader had to perform.
 *
 * A WEB TASK is the third branch and the one the union has no member for: its
 * contract is not a separate artifact but the entry's own fields — the steps and
 * the two named states it moves between. Rendering them here is what killed the
 * "No contract derived" card every web task used to dead-end at. `apiEffects` is
 * deliberately NOT rendered (2026-08-24) — implementation traffic, kept to the
 * catalog and the raw view; {@link GuardWebCalls} remains exported for a surface
 * that wants it. The rendered pieces are EXPORTED ({@link GuardWebSequence},
 * {@link GuardWebState}) because the screen page lays the same facts out inside
 * an expanded Actions row — never a second copy that could drift.
 *
 * The page reads ONCE, top to bottom: the place, its readables, the member's
 * title row, then here the grammar and the input/output facts. Nothing repeats
 * what the reader has already passed — a member's own identity is the row above,
 * and a web task's assertion surface is the place's readables, which the pane
 * renders once for every member at it.
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
 * There is no second nav here any more. One entry is one invocable thing
 * (2026-08-10), so a cli contract carries exactly ONE command — the tree lives in
 * the catalog as sibling entries sharing a group and a resource — and the command
 * list had been a nav onto a list of one ever since.
 */

import { FileQuestion } from 'lucide-react';
import {
  INTERFACE_UNKNOWN,
  type GuardInterfaceRow,
  type InterfaceApiBodyFact,
  type InterfaceApiRowFact,
  type InterfaceApiStatusFact,
  type InterfaceCommandContract,
  type InterfaceConsumes,
  type InterfaceEnvFact,
  type InterfaceExitFact,
  type InterfaceOperationContract,
  type InterfaceOption,
  type InterfaceOutputFact,
  type InterfaceProduces,
  type InterfacePromptFact,
  type InterfacePromptSubmit,
  type InterfaceReadFact,
  type InterfaceRequestField,
  type InterfaceRowFact,
  type InterfaceRowSlot,
  type InterfaceSequence,
  type InterfaceSequenceBranch,
  type InterfaceSequenceNode,
  type InterfaceState,
  type InterfaceStep,
  type InterfaceWriteFact,
} from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import { stepTargetText, type PomCall } from '@/lib/interface-pom';

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
export function GuardNoneLine() {
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

/**
 * A table that scrolls sideways INSIDE its own box — the pane never does.
 * Exported because the screen page renders its two tables in the same box.
 */
export function GuardTableBox({ children }: { children: React.ReactNode }) {
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
    <GuardTableBox>
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
    </GuardTableBox>
  );
}

function PositionalsTable({ command }: { command: InterfaceCommandContract }) {
  if (command.positionals === undefined) return null;
  if (command.positionals.length === 0) return <GuardNoneLine />;
  return (
    <GuardTableBox>
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
    </GuardTableBox>
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
function Template({ fact }: { fact: { template: string; slots: InterfaceRowSlot[] } }) {
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
      {list.length === 0 ? <GuardNoneLine /> : children(list)}
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
          {command.options?.length ? <GrammarTable options={command.options} /> : <GuardNoneLine />}
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

// ---------------------------------------------------------------------------
// The API OPERATION — the union's other member, in HTTP's own words. Before the
// SOM restructure an operation was rendered as a command: its identity read
// `GET /api/repos` under a "Commands" nav, its query parameters sat in a table
// headed "Flag", and its response statuses wore the "Exit codes" heading. Every
// one of those was a decoding step the reader had to do.
// ---------------------------------------------------------------------------

/** One request region — path, query or body — as a fact list, not a flag table. */
function RequestFields({ fields }: { fields: InterfaceRequestField[] }) {
  return (
    <GuardTableBox>
      <table className="w-full border-collapse">
        <thead className="border-b border-border bg-muted/30">
          <tr>
            <th className={HEAD}>Field</th>
            <th className={HEAD}>Required</th>
            <th className={HEAD}>Values</th>
            <th className={HEAD}>Default</th>
            <th className={HEAD}>What it is</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.name} className="border-b border-border/60 last:border-0">
              <td className={`${CELL} whitespace-nowrap font-mono`}>
                {field.name}
                {field.hint ? <span className="text-muted-foreground"> &lt;{field.hint}&gt;</span> : null}
              </td>
              <td className={`${CELL} whitespace-nowrap text-muted-foreground`}>
                {field.required === INTERFACE_UNKNOWN ? (
                  <HoverPopover
                    portal
                    width="narrow"
                    content="The field is read, and nothing in the source says whether it may be absent. Recorded as unknown rather than guessed."
                  >
                    <span className={CHIP}>{INTERFACE_UNKNOWN}</span>
                  </HoverPopover>
                ) : field.required ? (
                  'required'
                ) : (
                  'optional'
                )}
              </td>
              <td className={CELL}>
                {field.choices?.length ? (
                  <span className="font-mono text-[10px] text-foreground">{field.choices.join(' | ')}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className={`${CELL} whitespace-nowrap font-mono`}>
                {field.default === undefined ? (
                  <span className="font-sans text-muted-foreground">—</span>
                ) : (
                  String(field.default)
                )}
              </td>
              <td className={`${CELL} text-muted-foreground`}>{field.description ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </GuardTableBox>
  );
}

/** The response statuses — the api analog of the exit codes, `unknown` included. */
function StatusFacts({ facts }: { facts: InterfaceApiStatusFact[] }) {
  return (
    <FactList>
      {facts.map((fact, i) => (
        <li key={i} className={ROW}>
          {fact.status === INTERFACE_UNKNOWN ? (
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
            <span className="rounded bg-muted px-1 py-px font-mono text-[10px] text-foreground">{fact.status}</span>
          )}
          <When when={fact.when} />
        </li>
      ))}
    </FactList>
  );
}

/** Response-body markers. No stream chip: a response has one body. */
function BodyFacts({ facts }: { facts: InterfaceApiBodyFact[] }) {
  return (
    <FactList>
      {facts.map((fact, i) => (
        <li key={i} className={ROW}>
          <span className={FACT}>{fact.marker}</span>
          <When when={fact.when} />
        </li>
      ))}
    </FactList>
  );
}

/** The response's repeated-item shape — the row grammar, stream dropped. */
function ApiRowFacts({ facts }: { facts: InterfaceApiRowFact[] }) {
  return (
    <FactList>
      {facts.map((fact, i) => (
        <li key={i} className={ROW}>
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

function OperationContract({ operation }: { operation: InterfaceOperationContract }) {
  const { request, consumes, produces } = operation;
  return (
    <div>
      {operation.description ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{operation.description}</p>
      ) : null}

      {request ? (
        <Section title="Request">
          <div className="flex flex-col gap-3">
            {(
              [
                ['Path parameters', request.params],
                ['Query parameters', request.query],
                ['Body fields', request.body],
              ] as const
            ).map(([title, fields]) => (
              <Block key={title} title={title} list={fields as InterfaceRequestField[] | undefined}>
                {(list) => <RequestFields fields={list} />}
              </Block>
            ))}
          </div>
        </Section>
      ) : null}

      {consumes || produces ? (
        <Section title="Input and output">
          <div className="grid gap-x-6 gap-y-3 lg:grid-cols-2">
            {consumes ? (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-foreground">Consumes</div>
                <Block title="Environment" list={consumes.env}>
                  {(env) => <EnvFacts facts={env} />}
                </Block>
                <Block title="Reads" list={consumes.reads}>
                  {(reads) => <ReadFacts facts={reads} />}
                </Block>
              </div>
            ) : null}
            {produces ? (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-foreground">Produces</div>
                <Block title="Response statuses" list={produces.statuses}>
                  {(statuses) => <StatusFacts facts={statuses} />}
                </Block>
                <Block title="Response body" list={produces.body}>
                  {(body) => <BodyFacts facts={body} />}
                </Block>
                <Block title="Item shapes" list={produces.rows}>
                  {(rows) => <ApiRowFacts facts={rows} />}
                </Block>
                <Block title="Writes" list={produces.writes}>
                  {(writes) => <WriteFacts facts={writes} />}
                </Block>
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The WEB TASK — the third member, and the one the union has no entry for. A web
// task's contract is not a separate artifact: the SCHEMA already says it is the
// steps it runs, the two worlds it moves between, and the server calls it makes,
// and until now this component simply never honored that — every web task fell
// into the "No contract derived" empty state and `apiEffects`, the UI-to-API
// relation, was rendered nowhere at all.
//
// What is deliberately NOT here: the place's READABLES. They are what a scenario
// asserts on, and they belong to the PLACE, not to any one task at it — the pane
// renders them once, above the member list, and the page reads once.
// ---------------------------------------------------------------------------

/**
 * The world an id names, when its area's registry names it. Ids stay ids: two
 * members chain when these match exactly, and the description is the gloss.
 * Exported because the screen page's expanded Actions row shows the world a task
 * LEAVES in the same one line.
 */
export function GuardWebState({
  id,
  states,
}: {
  id: string;
  states?: readonly InterfaceState[];
}) {
  const described = states?.find((state) => state.id === id)?.description;
  return (
    <FactList>
      <li className={ROW}>
        <span className="rounded bg-muted px-1 py-px font-mono text-[10px] text-foreground">{id}</span>
        {described ? <span className="text-muted-foreground">{described}</span> : null}
      </li>
    </FactList>
  );
}

/** The steps in the order they run — the one thing every web task carries. */
export function GuardWebSequence({ steps }: { steps: readonly InterfaceStep[] }) {
  return (
    <ol className="divide-y divide-border/60">
      {steps.map((step, i) => (
        <li key={i} className={ROW}>
          <span className="text-[10px] text-muted-foreground">{i + 1}</span>
          <span className={CHIP}>{step.kind}</span>
          <span className={FACT}>{stepTargetText(step)}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * WHAT THE CLICK CALLS. Each id is joined against the catalog's own api entries
 * and minted into `noun.method()` beside the operation it is; an id that resolves
 * to NOTHING keeps its raw id, because a relation shown short reads as a screen
 * that reaches fewer endpoints than it does.
 */
export function GuardWebCalls({ calls }: { calls: readonly PomCall[] }) {
  return (
    <FactList>
      {calls.map((call) => (
        <li key={call.id} className={ROW}>
          <span className="font-mono">{call.name ? `${call.name}()` : call.id}</span>
          {call.operation ? (
            <span className="font-mono text-[10px] text-muted-foreground">{call.operation}</span>
          ) : null}
        </li>
      ))}
    </FactList>
  );
}

function WebContract({
  iface,
  states,
}: {
  iface: GuardInterfaceRow;
  states: readonly InterfaceState[] | undefined;
}) {
  return (
    <div>
      <Section title="Sequence">
        <GuardWebSequence steps={iface.steps} />
      </Section>

      {iface.startingState ? (
        <Section title="Assumes">
          <GuardWebState id={iface.startingState} {...(states ? { states } : {})} />
        </Section>
      ) : null}
      {iface.endState ? (
        <Section title="Leaves">
          <GuardWebState id={iface.endState} {...(states ? { states } : {})} />
        </Section>
      ) : null}

      {/* `apiEffects` is deliberately NOT rendered (2026-08-24): the calls a click
          fires are implementation traffic, not part of what a reader drives — the
          relation stays in the catalog and the raw view. */}
    </div>
  );
}

/**
 * The contract, dispatched on the surface it declares. There is no command NAV
 * any more: one entry is one invocable thing (2026-08-10), so a cli contract
 * carries exactly one command and a list of one was a nav onto itself.
 */
export function GuardInterfaceContract({
  iface,
  states,
}: {
  iface: GuardInterfaceRow;
  /** The state registry of this entry's AREA — the one line each state id names. */
  states?: readonly InterfaceState[];
}) {
  const contract = iface.contract;

  // A web task's contract IS what the entry carries — there is no second artifact
  // to be missing, so it never reaches the empty state below.
  if (iface.type === 'web') {
    return <WebContract iface={iface} states={states} />;
  }

  if (!contract) {
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

  // The SUMMARY is deliberately not rendered: the pane header above already says
  // what this entry is, and the page reads once.
  return (
    <div>
      {contract.surface === 'cli' ? (
        <CommandContract command={contract.command} showPath={false} />
      ) : (
        <OperationContract operation={contract.operation} />
      )}
    </div>
  );
}
