import type { ComponentType } from 'react';
import { SiClaude, SiGithubcopilot, SiOpenai, SiReplit, SiV0, SiWindsurf } from 'react-icons/si';

/** An AI builder, with its logo where the icon set has one; the rest go by name alone. */
type Tool = { name: string; Icon?: ComponentType };

const TOOLS: Tool[] = [
  { name: 'Lovable' },
  { name: 'Replit', Icon: SiReplit },
  { name: 'Claude Code', Icon: SiClaude },
  { name: 'Codex', Icon: SiOpenai },
  { name: 'Cursor' },
  { name: 'Bolt' },
  { name: 'v0', Icon: SiV0 },
  { name: 'Windsurf', Icon: SiWindsurf },
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
              {t.Icon && <t.Icon />}
              {t.name}
            </span>
          ))}
          <span className="strip-more">and more</span>
        </div>
      </div>
    </section>
  );
}
