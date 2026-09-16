import { useEffect, useRef, type ComponentType } from 'react';
import { Reveal } from './Reveal';
import { BoatGlyph } from './Sailboat';
import { ContextScreen } from '@/screens/ContextScreen';
import { ConnectScreen } from '@/screens/ConnectScreen';
import { FlowsScreen } from '@/screens/FlowsScreen';
import { PullRequestScreen } from '@/screens/PullRequestScreen';
import { ClaudeCodeScreen } from '@/screens/ClaudeCodeScreen';

const STEPS: { n: string; title: string; body: string; Screen: ComponentType }[] = [
  {
    n: '01',
    title: 'Connect your docs',
    body: 'Add wherever your requirements live. Repository markdown, a documentation site, Jira, Confluence, Google Drive, Notion.',
    Screen: ContextScreen,
  },
  {
    n: '02',
    title: 'Connect your repository',
    body: 'Pick the repositories those docs describe. TrueCourse maps their interfaces and installs as a check on each one.',
    Screen: ConnectScreen,
  },
  {
    n: '03',
    title: 'Docs become flows',
    body: 'Each requirement becomes a flow, a scenario run against the running product with every step on record.',
    Screen: FlowsScreen,
  },
  {
    n: '04',
    title: 'Every pull request is checked',
    body: 'Flows run in an isolated sandbox. A failing check quotes the doc sentence and what was observed instead.',
    Screen: PullRequestScreen,
  },
  {
    n: '05',
    title: 'Claude Code closes the loop',
    body: 'Claude Code reads the failing result over MCP, fixes the code, and the check goes green.',
    Screen: ClaudeCodeScreen,
  },
];

/** The dot's centre, measured from the top of its step's number. */
const DOT_CY = 10;

/**
 * The five steps down one column, each with its screen. A line runs down the
 * column's edge from step to step, drawn as each step comes into view, and the
 * boat sails down it: it docks on a step's dot as soon as that step's heading
 * has come well into view, so one requirement can be followed from the doc in
 * step 1 to the fix in step 5.
 */
export function HowItWorks() {
  const list = useRef<HTMLOListElement>(null);
  const boat = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const ol = list.current;
    const hull = boat.current;
    if (!ol || !hull) return;
    let raf = 0;
    const place = () => {
      raf = 0;
      const marks = Array.from(ol.querySelectorAll<HTMLElement>('.step-n'));
      if (marks.length === 0) return;
      const focal = window.innerHeight * 0.78;
      let at = 0;
      marks.forEach((mark, i) => {
        if (mark.getBoundingClientRect().top <= focal) at = i;
      });
      const y = marks[at]!.getBoundingClientRect().top + DOT_CY - ol.getBoundingClientRect().top;
      hull.style.transform = `translate(-50%, -50%) translateY(${y}px)`;
    };
    const ask = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    window.addEventListener('scroll', ask, { passive: true });
    window.addEventListener('resize', ask);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', ask);
      window.removeEventListener('resize', ask);
    };
  }, []);

  return (
    <section className="band" id="how">
      <div className="wrap">
        <h2 className="eyebrow">How it works</h2>
        <ol className="steps" ref={list}>
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
          <span className="course-boat" ref={boat} aria-hidden="true">
            <svg viewBox="0 0 100 100">
              <rect className="boat-clear" x={4} y={0} width={92} height={92} rx={12} />
              <BoatGlyph />
            </svg>
          </span>
        </ol>
      </div>
    </section>
  );
}
