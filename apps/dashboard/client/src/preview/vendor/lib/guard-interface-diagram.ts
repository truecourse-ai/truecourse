/**
 * Interface → sequence-diagram model. An interface is an entry-rooted interaction path
 * over ONE surface, so it reads as a sequence diagram: the user on the left, the
 * surface (and anything it talks to) to the right, one message per step.
 *
 * Pure and surface-agnostic, participants are derived from the STEP KINDS and
 * named by the driver registry, so a new surface's steps land without touching
 * the renderer.
 */

import { guardDriver } from '@/preview/vendor/shared';
import type { GuardDriverId, Interface, InterfaceStep } from '@/preview/vendor/shared';

/** The actor every interface starts from, the person driving the surface. */
export const INTERFACE_ACTOR = 'User';

export interface InterfaceMessage {
  /** Participant index the message starts at. */
  from: number;
  /** Participant index it lands on (`=== from` for a self-message). */
  to: number;
  /** The message text (mono), the surface-visible payload of the step. */
  label: string;
  kind: InterfaceStep['kind'];
}

export interface InterfaceDiagramModel {
  participants: string[];
  messages: InterfaceMessage[];
}

/** The product surface a step drives, by kind, a driver-registry id. */
const STEP_SURFACE: Record<InterfaceStep['kind'], GuardDriverId> = {
  invoke: 'cli',
  request: 'api',
  navigate: 'web',
  input: 'web',
  activate: 'web',
};

/** The participant a step talks TO, the surface's label from the driver registry. */
function targetOf(step: InterfaceStep): string {
  const surface = STEP_SURFACE[step.kind];
  return guardDriver(surface)?.label ?? surface;
}

/** The message text, the step's surface-visible payload, never internal symbols. */
export function interfaceStepLabel(step: InterfaceStep): string {
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
 * The diagram model of an interface: the actor plus every participant its steps
 * touch (first-seen order), and ONE message per step. `input` steps are
 * self-messages on their surface (a value typed into a field never crosses a
 * boundary).
 *
 * No state is drawn between the steps: within a task the chain IS step order
 * (2026-08-11), and the task's own two states are named above the diagram.
 */
export function interfaceDiagramModel(
  iface: Pick<Interface, 'steps'> & Partial<Pick<Interface, 'type'>>,
): InterfaceDiagramModel {
  const participants: string[] = [INTERFACE_ACTOR];
  const indexOf = (name: string): number => {
    const at = participants.indexOf(name);
    if (at !== -1) return at;
    participants.push(name);
    return participants.length - 1;
  };

  const messages = iface.steps.map((step) => {
    const to = indexOf(targetOf(step));
    return {
      from: step.kind === 'input' ? to : 0,
      to,
      label: interfaceStepLabel(step),
      kind: step.kind,
    };
  });

  return { participants, messages };
}
