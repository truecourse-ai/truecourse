// True bug: four nested callbacks, each a direct argument to the next
// call — the classic pyramid-of-doom shape that the rule is designed
// to catch. Refactor with async/await or named functions.

declare function fetchUser(id: string, cb: (user: { id: string }) => void): void;
declare function fetchOrders(uid: string, cb: (orders: { id: string }[]) => void): void;
declare function fetchItems(oid: string, cb: (items: unknown[]) => void): void;
declare function logAll(items: unknown[], cb: () => void): void;

export function loadUserPyramid(id: string): void {
  fetchUser(id, (user) => {
    fetchOrders(user.id, (orders) => {
      fetchItems(orders[0].id, (items) => {
        // VIOLATION: code-quality/deterministic/deep-callback-nesting
        logAll(items, () => {
          return;
        });
      });
    });
  });
}
