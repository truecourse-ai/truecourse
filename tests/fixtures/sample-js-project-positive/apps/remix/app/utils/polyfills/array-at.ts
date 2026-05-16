
// Side-effect polyfill file that mutates globalThis — export {} is required for ES module scope
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GlobalArray = globalThis.Array as any;

if (typeof GlobalArray.prototype.at !== 'function') {
  GlobalArray.prototype.at = function at(this: unknown[], index: number): unknown {
    const len = this.length;
    const relativeIndex = index < 0 ? len + index : index;
    return relativeIndex >= 0 && relativeIndex < len ? this[relativeIndex] : undefined;
  };
}

export {};
