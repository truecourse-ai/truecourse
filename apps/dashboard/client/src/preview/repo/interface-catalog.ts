/** Full-page catalog rows, using the same screen/operation/command joins as the guard pane. */
import type { GuardInterfaceRow, GuardInterfacesView } from '@truecourse/shared';
import {
  buildCommands, buildEndpoints, buildOperations, buildScreens, commandHaystack,
  looseEntries, memberHaystack, operationHaystack, placeSelectionId, screenHaystack, surfaceShape,
} from '@/lib/interface-pom';

export interface CatalogRow {
  id: string;
  surface: string;
  kind: 'screen' | 'operation' | 'command' | 'entries';
  title: string;
  hint: string;
  method?: string;
  members: GuardInterfaceRow[];
  search: string;
}

export function interfaceCatalog(view: GuardInterfacesView | null): { rows: CatalogRow[]; hidden: { surface: string; text: string }[] } {
  const rows: CatalogRow[] = [];
  const hidden: { surface: string; text: string }[] = [];
  if (!view) return { rows, hidden };
  const surfaces = [...new Set([...view.interfaces.map((i) => i.type), ...Object.keys(view.resources ?? {})])];
  for (const surface of surfaces) {
    const resources = view.resources?.[surface] ?? [];
    const shape = surfaceShape(surface);
    if (shape === 'commands') {
      for (const command of buildCommands(surface, view.interfaces)) {
        rows.push({ id: command.id, surface, kind: 'command', title: command.label,
          hint: command.iface.id, members: [command.iface], search: commandHaystack(command) });
      }
    } else if (shape === 'operations') {
      for (const operation of buildOperations(surface, resources, view.interfaces)) {
        rows.push({ id: operation.id, surface, kind: 'operation', title: operation.path,
          method: operation.method, hint: operation.iface.contract?.summary ?? operation.iface.id,
          members: [operation.iface], search: operationHaystack(operation) });
      }
      const empty = buildEndpoints(surface, resources, view.interfaces).filter((e) => e.members.length === 0).length;
      if (empty) hidden.push({ surface, text: `${empty} endpoint${empty === 1 ? '' : 's'} with no operations hidden` });
    } else {
      const entries = looseEntries(surface, resources, view.interfaces);
      if (entries.length) rows.push({ id: placeSelectionId(surface, ''), surface, kind: 'entries',
        title: 'Ways in', hint: 'Tasks that open this surface before any screen is open',
        members: entries, search: ['ways in', ...entries.map(memberHaystack)].join(' ').toLowerCase() });
      const screens = buildScreens(surface, resources, view.interfaces);
      for (const screen of screens.filter((s) => s.count > 0)) {
        rows.push({ id: screen.id, surface, kind: 'screen', title: screen.place.title,
          hint: screen.place.address ?? screen.place.id, members: screen.parts.flatMap((p) => p.members),
          search: screenHaystack(screen) });
      }
      const empty = screens.filter((s) => s.count === 0).length;
      if (empty) hidden.push({ surface, text: `${empty} screen${empty === 1 ? '' : 's'} with nothing to do hidden` });
    }
  }
  return { rows, hidden };
}

export function catalogOrigins(row: CatalogRow): string[] {
  return [...new Set(row.members.map((i) => i.origin ?? 'derived'))];
}

/** Count distinct flows across a screen's actions, including id-only grounding references. */
export function catalogUsage(row: CatalogRow): number {
  return new Set(row.members.flatMap((i) => [
    ...i.flows.map((f) => f.flowId), ...i.scenarioIds.map((id) => id.split('.')[0] ?? id),
  ])).size;
}
