
// Shape 657fef37e69b: match(x).with({type: P.union(...)}, handler) — valid ts-pattern exhaustive match.
declare function match<T>(value: T): { with<P>(pattern: P, handler: (v: T) => unknown): { otherwise: (fn: () => unknown) => unknown }; exhaustive(): unknown };
declare const P: { union: <T extends string>(...values: T[]) => { _type: T } };

enum ItemType { PHOTO = 'PHOTO', VIDEO = 'VIDEO', DOCUMENT = 'DOCUMENT', AUDIO = 'AUDIO' }
interface ContentItem { type: ItemType; url: string }
declare const contentItem: ContentItem;

function getContentCategory(item: ContentItem): 'media' | 'file' {
  return match(item)
    .with({ type: P.union(ItemType.PHOTO, ItemType.VIDEO, ItemType.AUDIO) }, () => 'media' as const)
    .otherwise(() => 'file' as const) as 'media' | 'file';
}
