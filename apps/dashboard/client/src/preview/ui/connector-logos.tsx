/**
 * The tool kinds' logos: the brands' own full-colour marks (the SVG Logos set,
 * CC0), shipped as image files beside this module and shown at the size the row
 * asks for. Add context lists these kinds locked, so the reader sees what the
 * product is heading for without being offered something that does not work.
 */

import type { ReactElement } from 'react';
import confluence from './logos/confluence.svg';
import gdrive from './logos/gdrive.svg';
import jira from './logos/jira.svg';
import notion from './logos/notion.svg';
import onedrive from './logos/onedrive.svg';
import slack from './logos/slack.svg';

export type ConnectorTool = 'jira' | 'confluence' | 'gdrive' | 'onedrive' | 'notion' | 'slack';

const LOGO: Record<ConnectorTool, string> = { jira, confluence, gdrive, onedrive, notion, slack };

export function ConnectorLogo({
  tool,
  className = 'h-6 w-6',
}: {
  tool: ConnectorTool;
  className?: string;
}): ReactElement {
  return <img src={LOGO[tool]} alt="" aria-hidden className={`${className} object-contain`} />;
}
