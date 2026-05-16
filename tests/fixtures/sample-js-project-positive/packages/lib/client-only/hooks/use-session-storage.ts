
declare const window: { dispatchEvent(e: Event): void; localStorage: { setItem(k: string, v: string): void; removeItem(k: string): void; getItem(k: string): string | null } };

function dispatchLocalStorageEvent(key: string, newValue: string | null) {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
}

function setLocalStorageItem<T>(key: string, value: T) {
  const stringified = JSON.stringify(value);
  window.localStorage.setItem(key, stringified);
  dispatchLocalStorageEvent(key, stringified);
}

function removeLocalStorageItem(key: string) {
  window.localStorage.removeItem(key);
  dispatchLocalStorageEvent(key, null);
}

function getLocalStorageItem(key: string) {
  return window.localStorage.getItem(key);
}
