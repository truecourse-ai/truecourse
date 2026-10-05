import type { ComponentType } from 'react';
import { SiGithubcopilot } from 'react-icons/si';
import {
  BoltLogo,
  ClaudeCodeLogo,
  CodexLogo,
  CursorLogo,
  LovableLogo,
  ReplitLogo,
  V0Logo,
  WindsurfLogo,
} from './aiLogos';

type Tool = { name: string; Icon: ComponentType };

const TOOLS: Tool[] = [
  { name: 'Lovable', Icon: LovableLogo },
  { name: 'Replit', Icon: ReplitLogo },
  { name: 'Claude Code', Icon: ClaudeCodeLogo },
  { name: 'Codex', Icon: CodexLogo },
  { name: 'Cursor', Icon: CursorLogo },
  { name: 'Bolt', Icon: BoltLogo },
  { name: 'v0', Icon: V0Logo },
  { name: 'Windsurf', Icon: WindsurfLogo },
  { name: 'GitHub Copilot', Icon: SiGithubcopilot },
];

/** The quiet row under the hero: the AI tools the apps it watches are built with. */
export function BuiltWith() {
  return (
    <section className="strip" aria-label="Works with apps built with AI tools">
      <div className="wrap strip-rows">
        <div className="strip-row">
          <span className="strip-label">For apps built with</span>
          {TOOLS.map((t) => (
            <span className="strip-item" key={t.name}>
              <t.Icon />
              {t.name}
            </span>
          ))}
          <span className="strip-more">and more</span>
        </div>
      </div>
    </section>
  );
}
