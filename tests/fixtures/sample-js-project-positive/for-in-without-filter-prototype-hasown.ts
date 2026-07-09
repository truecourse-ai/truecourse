// A for…in loop that DOES filter inherited keys: it captures the own-property
// predicate from the prototype and applies it to each key before acting. The
// filter is present, so this must not be flagged as a for…in missing an
// own-property check.

export function hasNoOwnKeys(record: object): boolean {
  for (const key in record) {
    const ownProperty = Object.prototype.hasOwnProperty;
    if (ownProperty.call(record, key)) {
      return false;
    }
  }
  return true;
}
