/**
 * Settings › Connections: the tools a document can come from, one row each with
 * its brand mark and the shared name of its kind.
 *
 * None can be connected yet, so every row says Coming soon and none of them is
 * a control: hiding them would make the page lie about where this is going, and
 * offering them would make it lie about what it does.
 */

import { CONTEXT_SOURCE_KIND_LABEL } from '@truecourse/shared';
import type { ContextSourceKind } from '@truecourse/shared';
import { ConnectorLogo, type ConnectorTool } from './connector-logos';

const CONNECTORS: readonly { kind: ContextSourceKind; tool: ConnectorTool }[] = [
  { kind: 'jira', tool: 'jira' },
  { kind: 'confluence', tool: 'confluence' },
  { kind: 'google-drive', tool: 'gdrive' },
  { kind: 'onedrive', tool: 'onedrive' },
  { kind: 'notion', tool: 'notion' },
  { kind: 'slack', tool: 'slack' },
];

export function ConnectionsTab() {
  return (
    <ul className="divide-y divide-border border-b border-border" aria-label="Connectors">
      {CONNECTORS.map((connector) => (
        <li key={connector.kind} className="flex items-start gap-4 px-6 py-3">
          <ConnectorLogo tool={connector.tool} className="mt-0.5 h-6 w-6 shrink-0" />
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="truncate text-[13px] font-medium text-foreground">
              {CONTEXT_SOURCE_KIND_LABEL[connector.kind]}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">Coming soon</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
