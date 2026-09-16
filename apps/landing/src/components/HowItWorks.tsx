import type { ComponentType } from 'react';
import { Reveal } from './Reveal';
import { ContextScreen } from '@/screens/ContextScreen';
import { ConnectScreen } from '@/screens/ConnectScreen';
import { FlowsScreen } from '@/screens/FlowsScreen';
import { PullRequestScreen } from '@/screens/PullRequestScreen';

const STEPS: { n: string; title: string; body: string; Screen: ComponentType }[] = [
  {
    n: '01',
    title: 'Connect your docs',
    body: 'Add wherever your requirements live: repository markdown, a documentation site, Jira, Confluence, Google Drive, Notion.',
    Screen: ContextScreen,
  },
  {
    n: '02',
    title: 'Connect your repository',
    body: 'Pick the repositories those docs describe, and TrueCourse installs as a check on each one.',
    Screen: ConnectScreen,
  },
  {
    n: '03',
    title: 'Docs become flows',
    body: 'Each requirement becomes a flow: a scenario test, proven against the running product.',
    Screen: FlowsScreen,
  },
  {
    n: '04',
    title: 'Every pull request is checked',
    body: 'Flows run in an isolated sandbox. A failing check quotes the doc sentence and what was observed instead.',
    Screen: PullRequestScreen,
  },
];

/**
 * The four steps down one column, each with its screen. A line runs down the
 * column's edge from step to step, drawn as each step comes into view, so one
 * requirement can be followed from the doc in step 1 to the gate in step 4.
 */
export function HowItWorks() {
  return (
    <section className="band" id="how">
      <div className="wrap">
        <h2 className="eyebrow">How it works</h2>
        <ol className="steps">
          {STEPS.map((step, i) => (
            <Reveal as="li" className="step" key={step.n} threshold={0.4}>
              <div className="step-text">
                <span className="step-n">{step.n}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
              <div className="screen">
                <step.Screen />
              </div>
              {i < STEPS.length - 1 && <span className="step-seg" aria-hidden="true" />}
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
