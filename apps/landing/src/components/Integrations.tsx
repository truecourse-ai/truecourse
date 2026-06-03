import type { IconType } from 'react-icons';
import {
  SiAsana,
  SiBitbucket,
  SiConfluence,
  SiDiscord,
  SiDropbox,
  SiGitea,
  SiGithub,
  SiGitlab,
  SiGoogledocs,
  SiJira,
  SiLinear,
  SiNotion,
  SiSlack,
  SiTrello,
} from 'react-icons/si';
import { Reveal } from './Reveal';

type Tool = { Icon: IconType; name: string; hint: string };

const KB_TOOLS: Tool[] = [
  { Icon: SiNotion, name: 'Notion', hint: 'specs, OKRs' },
  { Icon: SiConfluence, name: 'Confluence', hint: 'engineering wikis' },
  { Icon: SiSlack, name: 'Slack', hint: 'decision threads' },
  { Icon: SiGithub, name: 'GitHub', hint: 'READMEs, ADRs' },
  { Icon: SiGoogledocs, name: 'Google Docs', hint: 'design reviews' },
  { Icon: SiLinear, name: 'Linear', hint: 'tickets' },
  { Icon: SiJira, name: 'Jira', hint: 'tickets' },
];

const KB_MORE: IconType[] = [SiAsana, SiTrello, SiDropbox, SiDiscord];

const PR_GATES: Tool[] = [
  { Icon: SiGithub, name: 'GitHub', hint: 'cloud + Enterprise Server' },
  { Icon: SiGitlab, name: 'GitLab', hint: 'cloud + self-managed' },
  { Icon: SiBitbucket, name: 'Bitbucket', hint: 'cloud + Data Center' },
  { Icon: SiGitea, name: 'Gitea', hint: 'self-hosted' },
];

export function Integrations() {
  return (
    <section className="band" id="integrations">
      <div className="wrap">
        <Reveal as="p" className="eyebrow">
          Integrations
        </Reveal>
        <Reveal as="h2" className="section-title">
          <span className="dim">We plug into the tools</span> your team{' '}
          <span className="hl">already uses.</span>
        </Reveal>
        <Reveal as="p" className="section-lead">
          No new workflow to adopt. We capture decisions from where your team writes them,
          and gate every PR on the platform you already host code on.
        </Reveal>

        <Reveal className="subhead">
          <p className="e">Knowledge sources</p>
          <h3>Where decisions live</h3>
          <p>Capture from the sources your team already uses.</p>
        </Reveal>
        <div className="grid cols-4" style={{ marginTop: 26 }}>
          {KB_TOOLS.map((t, i) => (
            <Reveal key={t.name} className="tool" delay={i * 50}>
              <span className="glyph">
                <t.Icon />
              </span>
              <div>
                <div className="tname">{t.name}</div>
                <div className="thint">{t.hint}</div>
              </div>
            </Reveal>
          ))}
          <Reveal className="tool dashed" delay={KB_TOOLS.length * 50}>
            <span className="more-glyphs">
              {KB_MORE.map((Icon, i) => (
                <Icon key={i} />
              ))}
            </span>
            <div>
              <div className="tname">and more</div>
              <div className="thint">on request</div>
            </div>
          </Reveal>
        </div>

        <Reveal className="subhead">
          <p className="e">PR gates</p>
          <h3>Where we gate PRs</h3>
          <p>Verify every change on the platform you already host code on.</p>
        </Reveal>
        <div className="grid cols-4" style={{ marginTop: 26 }}>
          {PR_GATES.map((t, i) => (
            <Reveal key={t.name} className="tool" delay={i * 60}>
              <span className="glyph">
                <t.Icon />
              </span>
              <div>
                <div className="tname">{t.name}</div>
                <div className="thint">{t.hint}</div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal as="p" className="fine">
          Azure DevOps and other platforms on request.
        </Reveal>
      </div>
    </section>
  );
}
