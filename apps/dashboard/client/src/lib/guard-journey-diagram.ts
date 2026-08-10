/**
 * Journey → sequence-diagram model. A journey is an entry-rooted interaction path
 * over ONE surface, so it reads as a sequence diagram: the user on the left, the
 * surface (and anything it talks to) to the right, one message per step.
 *
 * Pure and surface-agnostic — participants are derived from the STEP KINDS and
 * named by the driver registry, so a new surface's steps land without touching
 * the renderer.
 */

import { guardDriver } from '@truecourse/shared';
import type { GuardDriverId, Journey, JourneyStep } from '@truecourse/shared';

/** The actor every journey starts from — the person driving the surface. */
export const JOURNEY_ACTOR = 'User';

export interface JourneyMessage {
  /** Participant index the message starts at. */
  from: number;
  /** Participant index it lands on (`=== from` for a self-message). */
  to: number;
  /** The message text (mono) — the surface-visible payload of the step. */
  label: string;
  kind: JourneyStep['kind'];
  /**
   * A REPLY: the step's `output` — the interaction change the action produced
   * (a dropdown opened, the cards gone), flowing surface → user. Prose about
   * state, rendered dashed and unmono to keep it apart from the actions.
   */
  reply?: boolean;
}

export interface JourneyDiagramModel {
  participants: string[];
  messages: JourneyMessage[];
}

/** The product surface a step drives, by kind — a driver-registry id. */
const STEP_SURFACE: Record<JourneyStep['kind'], GuardDriverId> = {
  invoke: 'cli',
  request: 'api',
  navigate: 'web',
  input: 'web',
  activate: 'web',
};

/** The participant a step talks TO — the surface's label from the driver registry. */
function targetOf(step: JourneyStep): string {
  const surface = STEP_SURFACE[step.kind];
  return guardDriver(surface)?.label ?? surface;
}

/** The message text — the step's surface-visible payload, never internal symbols. */
export function journeyStepLabel(step: JourneyStep): string {
  switch (step.kind) {
    case 'invoke':
      return [...step.command, ...step.flags].join(' ');
    case 'request':
      return `${step.method.toUpperCase()} ${step.path}`;
    case 'navigate':
      return `navigate ${step.route}`;
    case 'input':
      return `fill ${step.target}`;
    default:
      return `activate ${step.target}`;
  }
}

/**
 * The diagram model of a journey: the actor plus every participant its steps
 * touch (first-seen order), and one message per step. `input` steps are
 * self-messages on their surface (a value typed into a field never crosses a
 * boundary).
 *
 * A step that states its `output` (the state handoff) is followed by a REPLY
 * message flowing back to the actor — the interaction change the action
 * produced. The step's `input` is not drawn: the chain invariant makes it the
 * previous reply (or the journey's starting state, which the pane already
 * shows above the diagram), so drawing it would say everything twice.
 */
export function journeyDiagramModel(
  journey: Pick<Journey, 'steps'> & Partial<Pick<Journey, 'type'>>,
): JourneyDiagramModel {
  const participants: string[] = [JOURNEY_ACTOR];
  const indexOf = (name: string): number => {
    const at = participants.indexOf(name);
    if (at !== -1) return at;
    participants.push(name);
    return participants.length - 1;
  };

  const messages = journey.steps.flatMap((step) => {
    const to = indexOf(targetOf(step));
    const action = {
      from: step.kind === 'input' ? to : 0,
      to,
      label: journeyStepLabel(step),
      kind: step.kind,
    };
    return step.output
      ? [action, { from: to, to: 0, label: step.output, kind: step.kind, reply: true }]
      : [action];
  });

  return { participants, messages };
}
