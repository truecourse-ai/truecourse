import { useEffect, useRef, useMemo, useState } from 'react';
import { EditorView, lineNumbers, gutter, GutterMarker, Decoration, type DecorationSet, WidgetType } from '@codemirror/view';
import { EditorState, StateField, RangeSet, Compartment } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
import type { CodeViolationResponse } from '@/lib/api';

type CodeViewerProps = {
  content: string;
  language: string;
  violations: CodeViolationResponse[];
  scrollToLine?: number;
};

// Match ViolationCard colors: info=blue, low=amber, medium=orange, high=red, critical=red-600
const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#ef4444',
  medium: '#f97316',
  low: '#f59e0b',
  info: '#3b82f6',
};

const SEVERITY_BG: Record<string, string> = {
  critical: 'rgba(220,38,38,0.08)',
  high: 'rgba(239,68,68,0.08)',
  medium: 'rgba(249,115,22,0.08)',
  low: 'rgba(245,158,11,0.08)',
  info: 'rgba(59,130,246,0.08)',
};

const SEVERITY_BORDER: Record<string, string> = {
  critical: 'rgba(220,38,38,0.3)',
  high: 'rgba(239,68,68,0.3)',
  medium: 'rgba(249,115,22,0.3)',
  low: 'rgba(245,158,11,0.3)',
  info: 'rgba(59,130,246,0.3)',
};

const SEVERITY_ICONS: Record<string, string> = {
  critical: '\u26d4',  // ⛔
  high: '\u26a0\ufe0f', // ⚠️
  medium: '\u26a0\ufe0f',
  low: '\u2139\ufe0f',  // ℹ️
  info: '\u2139\ufe0f',
};

// Position within a violation range
type MarkerPosition = 'single' | 'start' | 'middle' | 'end';

// Gutter marker: dot on first line, vertical line for the rest
class ViolationMarker extends GutterMarker {
  severity: string;
  position: MarkerPosition;

  constructor(severity: string, position: MarkerPosition) {
    super();
    this.severity = severity;
    this.position = position;
  }

  toDOM() {
    const color = SEVERITY_COLORS[this.severity] || SEVERITY_COLORS.info;
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      position: relative;
    `;

    const line = document.createElement('div');
    if (this.position === 'single') {
      line.style.cssText = `
        width: 2px;
        height: 60%;
        background: ${color};
      `;
    } else {
      const top = this.position === 'start' ? '50%' : '0';
      const bottom = this.position === 'end' ? '50%' : '0';
      line.style.cssText = `
        position: absolute;
        width: 2px;
        top: ${top};
        bottom: ${bottom};
        left: 50%;
        transform: translateX(-50%);
        background: ${color};
      `;
    }
    wrapper.appendChild(line);

    return wrapper;
  }
}

// Inline widget rendered below the violation line
class ViolationWidget extends WidgetType {
  violations: CodeViolationResponse[];

  constructor(violations: CodeViolationResponse[]) {
    super();
    this.violations = violations;
  }

  toDOM() {
    const container = document.createElement('div');
    container.style.cssText = 'padding: 2px 0 2px 48px;';

    for (const v of this.violations) {
      const color = SEVERITY_COLORS[v.severity] || SEVERITY_COLORS.info;
      const bg = SEVERITY_BG[v.severity] || SEVERITY_BG.info;
      const border = SEVERITY_BORDER[v.severity] || SEVERITY_BORDER.info;

      const row = document.createElement('div');
      row.style.cssText = `
        display: flex;
        align-items: flex-start;
        gap: 6px;
        padding: 4px 10px;
        border-left: 3px solid ${color};
        background: ${bg};
        border-radius: 0 4px 4px 0;
        font-size: 12px;
        line-height: 18px;
        cursor: pointer;
      `;

      // Severity badge
      const badge = document.createElement('span');
      badge.textContent = v.severity.toUpperCase();
      badge.style.cssText = `
        flex-shrink: 0;
        padding: 0 5px;
        border-radius: 3px;
        font-size: 10px;
        font-weight: 600;
        border: 1px solid ${border};
        color: ${color};
        background: transparent;
        line-height: 18px;
      `;

      // Title
      const title = document.createElement('span');
      title.textContent = v.title;
      title.style.cssText = `
        font-weight: 600;
        color: var(--foreground);
        flex-shrink: 0;
      `;

      // Separator
      const sep = document.createElement('span');
      sep.textContent = ' — ';
      sep.style.cssText = 'color: var(--muted-foreground); flex-shrink: 0;';

      // Description
      const desc = document.createElement('span');
      desc.textContent = v.content;
      desc.style.cssText = 'color: var(--muted-foreground);';

      row.appendChild(badge);
      row.appendChild(title);
      row.appendChild(sep);
      row.appendChild(desc);

      // Fix prompt (expandable)
      if (v.fixPrompt) {
        const fix = document.createElement('div');
        fix.style.cssText = `
          display: none;
          margin-top: 4px;
          padding: 4px 8px;
          background: var(--muted);
          border-radius: 3px;
          font-size: 11px;
          color: var(--muted-foreground);
          font-style: italic;
        `;
        fix.textContent = v.fixPrompt;

        row.addEventListener('click', () => {
          fix.style.display = fix.style.display === 'none' ? 'block' : 'none';
        });

        const wrapper = document.createElement('div');
        wrapper.appendChild(row);
        wrapper.appendChild(fix);
        container.appendChild(wrapper);
      } else {
        container.appendChild(row);
      }
    }

    return container;
  }

  eq(other: ViolationWidget) {
    if (this.violations.length !== other.violations.length) return false;
    return this.violations.every((v, i) => v.id === other.violations[i].id);
  }

  ignoreEvent() {
    return false;
  }
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

const bgTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--card)',
    borderRight: '1px solid var(--border)',
    color: 'var(--muted-foreground)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--muted)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--muted)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--accent)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--foreground)',
  },
});

function getThemeExtension(dark: boolean) {
  return dark ? vscodeDark : vscodeLight;
}

export function CodeViewer({ content, language, violations, scrollToLine }: CodeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const highlightCompartment = useRef(new Compartment());
  const [dark, setDark] = useState(isDarkMode);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(isDarkMode());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: highlightCompartment.current.reconfigure(
        getThemeExtension(dark),
      ),
    });
  }, [dark]);

  // Group violations by the END line of their range (widget goes after the last affected line).
  // Invariant: every violation with a filePath also has lineStart+lineEnd
  // (enforced at the checker layer), so no null guards here.
  const violationsByEndLine = useMemo(() => {
    const map = new Map<number, CodeViolationResponse[]>();
    for (const v of violations) {
      const endLine = v.lineEnd ?? v.lineStart;
      let list = map.get(endLine);
      if (!list) {
        list = [];
        map.set(endLine, list);
      }
      list.push(v);
    }
    return map;
  }, [violations]);

  // Build set of all lines that have violations (for line highlighting)
  const violationLineSet = useMemo(() => {
    const set = new Set<number>();
    for (const v of violations) {
      const end = v.lineEnd ?? v.lineStart;
      for (let line = v.lineStart; line <= end; line++) {
        set.add(line);
      }
    }
    return set;
  }, [violations]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Gutter markers: dot on first line, vertical line continuing through the range
    const violationGutter = gutter({
      class: 'cm-violation-gutter',
      lineMarker(view, line) {
        const lineNo = view.state.doc.lineAt(line.from).number;
        if (!violationLineSet.has(lineNo)) return null;

        const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
        let highest = 'info';
        let isStart = false;
        let isEnd = false;
        let isSingle = false;

        for (const v of violations) {
          const end = v.lineEnd || v.lineStart;
          if (lineNo >= v.lineStart && lineNo <= end) {
            const idx = severityOrder.indexOf(v.severity);
            if (idx < severityOrder.indexOf(highest)) highest = v.severity;
            if (v.lineStart === end) isSingle = true;
            else {
              if (lineNo === v.lineStart) isStart = true;
              if (lineNo === end) isEnd = true;
            }
          }
        }

        let position: MarkerPosition;
        if (isSingle && !isStart && !isEnd) position = 'single';
        else if (isStart && !isEnd) position = 'start';
        else if (isEnd && !isStart) position = 'end';
        else if (isStart && isEnd) position = 'single';
        else position = 'middle';

        return new ViolationMarker(highest, position);
      },
    });

    // Line highlight + inline widget decorations
    const violationLineDeco = Decoration.line({ class: 'cm-violation-line' });

    const violationField = StateField.define<DecorationSet>({
      create(state) {
        const decos: Array<{ from: number; value: Decoration }> = [];

        // Line highlights
        for (const lineNo of violationLineSet) {
          if (lineNo <= state.doc.lines) {
            const line = state.doc.line(lineNo);
            decos.push({ from: line.from, value: violationLineDeco });
          }
        }

        // Inline widgets after the last line of each violation group
        for (const [endLine, vs] of violationsByEndLine) {
          if (endLine <= state.doc.lines) {
            const line = state.doc.line(endLine);
            const widget = Decoration.widget({
              widget: new ViolationWidget(vs),
              block: true,
              side: 1, // after the line
            });
            decos.push({ from: line.to, value: widget });
          }
        }

        decos.sort((a, b) => a.from - b.from);
        return RangeSet.of(decos.map((d) => d.value.range(d.from)));
      },
      update(value) {
        return value;
      },
      provide: (f) => EditorView.decorations.from(f),
    });

    const langExtension = language === 'typescript' || language === 'javascript'
      ? javascript({ typescript: language === 'typescript', jsx: true })
      : javascript();

    const initialDark = isDarkMode();

    const state = EditorState.create({
      doc: content,
      extensions: [
        langExtension,
        highlightCompartment.current.of(getThemeExtension(initialDark)),
        bgTheme,
        lineNumbers(),
        EditorView.editable.of(false),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { overflow: 'auto', height: '100%' },
          '.cm-violation-gutter .cm-gutterElement': { display: 'flex', alignItems: 'center', justifyContent: 'center' },
          '.cm-violation-gutter': { width: '16px' },
          '.cm-violation-line': {
            backgroundColor: 'rgba(234, 179, 8, 0.06)',
          },
        }),
        violationGutter,
        violationField,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    if (scrollToLine && scrollToLine <= view.state.doc.lines) {
      const line = view.state.doc.line(scrollToLine);
      view.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
      });
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [content, language, violationsByEndLine, violationLineSet, violations, scrollToLine]);

  return <div ref={containerRef} className="h-full w-full" />;
}
