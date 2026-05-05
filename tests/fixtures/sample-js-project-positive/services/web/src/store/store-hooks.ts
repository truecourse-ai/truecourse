/**
 * Zustand-style stores. The `useXxxStore` functions are React hooks for
 * subscribing inside components. The `.getState()` / `.setState()` static
 * methods are the canonical way to read/write store state OUTSIDE of React
 * (event handlers, WebSocket callbacks, services). They are NOT hook calls.
 */

interface Metrics {
  count: number;
  duration: number;
}

interface MetricsState {
  metrics: Metrics;
  setMetrics: (next: Metrics) => boolean;
}

interface BrowserState {
  setScreenshotSrc: (src: string) => boolean;
  setUrl: (url: string) => boolean;
}

interface MetricsStoreApi {
  getState: () => MetricsState;
}
interface BrowserStoreApi {
  getState: () => BrowserState;
}

declare const useMetricsStore: MetricsStoreApi & (() => Metrics);
declare const useBrowserStore: BrowserStoreApi & (() => { url: string });

type WsMessage =
  | { kind: 'metrics'; metrics: Metrics }
  | { kind: 'screenshot'; src: string }
  | { kind: 'navigate'; url: string };

// Imperative consumers — `.getState()` calls on Zustand hooks inside
// conditionals are NOT hook calls and must not be flagged.
export function handleWebsocketMessage(message: WsMessage): boolean {
  switch (message.kind) {
    case 'metrics':
      return useMetricsStore.getState().setMetrics(message.metrics);
    case 'screenshot':
      return useBrowserStore.getState().setScreenshotSrc(message.src);
    case 'navigate':
      if (message.url.length > 0) {
        return useBrowserStore.getState().setUrl(message.url);
      }
      return false;
  }
}

export function maybeRecordMetrics(metrics: Metrics | undefined): boolean {
  if (metrics !== undefined && metrics.count > 0) {
    return useMetricsStore.getState().setMetrics(metrics);
  }
  return false;
}
