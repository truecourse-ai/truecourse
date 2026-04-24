import type {
  ServiceRow,
  LayerRow,
  ModuleRow,
  MethodRow,
} from './graph.service.js';

/**
 * Build a bidirectional map between UUID-based graph node ids and stable
 * name-based keys so the UI can save positions/collapse state that survives
 * re-analysis (UUIDs regenerate on each run; names/paths stay).
 *
 * Stable-key formats:
 * - Service:        `svc:{serviceName}`
 * - Layer:          `layer:{serviceName}::{layerName}`   (node id = `${svcId}__${layer}`)
 * - Module:         `module:{serviceName}::{filePath}`
 * - Method:         `method:{serviceName}::{filePath}::{methodName}`
 */
export interface StableKeyMap {
  toStable(uuid: string): string | null;
  toUuid(stable: string): string | null;
}

export interface StableKeyInput {
  services: ServiceRow[];
  layers: LayerRow[];
  modules: ModuleRow[];
  methods: MethodRow[];
}

export function buildStableKeyMap(input: StableKeyInput): StableKeyMap {
  const uuidToStable = new Map<string, string>();
  const stableToUuid = new Map<string, string>();

  const register = (uuid: string, stable: string) => {
    uuidToStable.set(uuid, stable);
    stableToUuid.set(stable, uuid);
  };

  const serviceNameById = new Map<string, string>();
  for (const svc of input.services) {
    serviceNameById.set(svc.id, svc.name);
    register(svc.id, `svc:${svc.name}`);
  }

  const modulePathById = new Map<string, string>();
  const moduleServiceById = new Map<string, string>();
  for (const mod of input.modules) {
    modulePathById.set(mod.id, mod.filePath);
    moduleServiceById.set(mod.id, mod.serviceId);
    const svcName = serviceNameById.get(mod.serviceId);
    if (svcName) register(mod.id, `module:${svcName}::${mod.filePath}`);
  }

  for (const method of input.methods) {
    const modFilePath = modulePathById.get(method.moduleId);
    const modServiceId = moduleServiceById.get(method.moduleId);
    const svcName = modServiceId ? serviceNameById.get(modServiceId) : undefined;
    if (svcName && modFilePath) {
      register(method.id, `method:${svcName}::${modFilePath}::${method.name}`);
    }
  }

  // Layer nodes use composite ids (`${svcId}__${layer}`) rather than raw UUIDs.
  for (const layer of input.layers) {
    const svcName = serviceNameById.get(layer.serviceId);
    if (!svcName) continue;
    register(`${layer.serviceId}__${layer.layer}`, `layer:${svcName}::${layer.layer}`);
  }

  return {
    toStable: (uuid) => uuidToStable.get(uuid) ?? null,
    toUuid: (stable) => stableToUuid.get(stable) ?? null,
  };
}

/** Translate a UUID-keyed position map into a stable-keyed one (drops unknown ids). */
export function positionsToStable(
  map: StableKeyMap,
  positions: Record<string, { x: number; y: number }>,
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const [uuid, pos] of Object.entries(positions)) {
    const stable = map.toStable(uuid);
    if (stable) out[stable] = pos;
  }
  return out;
}

/** Translate a list of UUIDs into stable keys (drops unknown ids). */
export function idsToStable(map: StableKeyMap, ids: string[]): string[] {
  const out: string[] = [];
  for (const uuid of ids) {
    const stable = map.toStable(uuid);
    if (stable) out.push(stable);
  }
  return out;
}

/** Translate stable-keyed positions back to UUID-keyed (drops unknown stable keys). */
export function positionsToUuid(
  map: StableKeyMap,
  positions: Record<string, { x: number; y: number }>,
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const [stable, pos] of Object.entries(positions)) {
    const uuid = map.toUuid(stable);
    if (uuid) out[uuid] = pos;
  }
  return out;
}

/** Translate a list of stable keys back into UUIDs (drops unknown stable keys). */
export function idsToUuid(map: StableKeyMap, stableIds: string[]): string[] {
  const out: string[] = [];
  for (const stable of stableIds) {
    const uuid = map.toUuid(stable);
    if (uuid) out.push(uuid);
  }
  return out;
}
