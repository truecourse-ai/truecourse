/**
 * Settings › MCP: where this server's MCP is, and the command that adds it to
 * Claude Code. Present in every mode.
 *
 * What it shows is what `GET /api/capabilities` answered. Hosted, the URL is
 * the one the operator configured, and the Claude app can add it as a custom
 * connector too; a hosted server without MCP sign-in has no URL to give.
 */

import { SectionTitle } from '@/dashboard/ui/bits';
import { StatusWord } from '@/dashboard/ui/status-word';
import { useCopied } from '@/dashboard/ui/use-copied';
import { useCapabilityContext } from '@/contexts/CapabilityContext';

const DOCS_URL = 'https://docs.truecourse.dev/settings/mcp';

const command = (url: string): string => `claude mcp add --transport http truecourse ${url}`;

const ACTION =
  'shrink-0 rounded border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted/60';

function CopyRow({
  label,
  text,
  copied,
  onCopy,
}: {
  label: string;
  text: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-4 py-1.5 text-xs">
      <span className="w-44 shrink-0 text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 select-all break-all font-mono text-foreground">{text}</code>
      {copied && <StatusWord tone="success" word="Copied" />}
      <button type="button" onClick={onCopy} className={ACTION} aria-label={`Copy ${label}`}>
        Copy
      </button>
    </div>
  );
}

export function McpTab() {
  const { mode, mcp, isLoading, error } = useCapabilityContext();
  const { copied, copy } = useCopied();
  if (isLoading || error) return null;

  return (
    <section aria-label="Connect Claude" className="px-6 py-5">
      <div className="flex items-center gap-2">
        <SectionTitle>Connect Claude</SectionTitle>
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-[11px] font-medium text-primary hover:underline"
        >
          Read the MCP docs
        </a>
      </div>
      {mcp.available ? (
        <div className="mt-2 divide-y divide-border/60">
          <CopyRow
            label="MCP URL"
            text={mcp.url}
            copied={copied === 'url'}
            onCopy={() => void copy('url', mcp.url)}
          />
          <CopyRow
            label="Claude Code"
            text={command(mcp.url)}
            copied={copied === 'command'}
            onCopy={() => void copy('command', command(mcp.url))}
          />
          {mode === 'hosted' && (
            <p className="py-1.5 text-xs text-muted-foreground">
              Or add this URL in the Claude app › Settings › Connectors › Add custom connector.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">MCP sign-in is not configured on this server.</p>
      )}
    </section>
  );
}
