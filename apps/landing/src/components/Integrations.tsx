import type { ComponentType } from 'react';
import { VscAzureDevops } from 'react-icons/vsc';
import {
  SiBitbucket,
  SiConfluence,
  SiGitea,
  SiGithub,
  SiGitlab,
  SiGoogledrive,
  SiJira,
  SiLinear,
  SiNotion,
  SiSlack,
} from 'react-icons/si';
import { OneDriveIcon } from './OneDriveIcon';

type Tool = { Icon: ComponentType; name: string };

const DOCS: Tool[] = [
  { Icon: SiGithub, name: 'GitHub' },
  { Icon: SiConfluence, name: 'Confluence' },
  { Icon: SiJira, name: 'Jira' },
  { Icon: SiGoogledrive, name: 'Google Drive' },
  { Icon: OneDriveIcon, name: 'OneDrive' },
  { Icon: SiNotion, name: 'Notion' },
  { Icon: SiLinear, name: 'Linear' },
  { Icon: SiSlack, name: 'Slack' },
];

const CODE: Tool[] = [
  { Icon: SiGithub, name: 'GitHub' },
  { Icon: SiGitlab, name: 'GitLab' },
  { Icon: VscAzureDevops, name: 'Azure DevOps' },
  { Icon: SiBitbucket, name: 'Bitbucket' },
  { Icon: SiGitea, name: 'Gitea' },
];

/** A row of logos never claims to be the whole list. */
function Row({ label, tools }: { label: string; tools: Tool[] }) {
  return (
    <div className="strip-row">
      <span className="strip-label">{label}</span>
      {tools.map((t) => (
        <span className="strip-item" key={t.name}>
          <t.Icon />
          {t.name}
        </span>
      ))}
      <span className="strip-more">and more</span>
    </div>
  );
}

/** Two quiet rows: where the docs come from, where the pull requests live. */
export function Integrations() {
  return (
    <section className="strip" id="integrations" aria-label="Integrations">
      <div className="wrap strip-rows">
        <Row label="Docs from" tools={DOCS} />
        <Row label="Code on" tools={CODE} />
      </div>
    </section>
  );
}
