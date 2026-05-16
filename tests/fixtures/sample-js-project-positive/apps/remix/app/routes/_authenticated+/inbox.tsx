
declare function appMetaTags(title: string): Array<{ title?: string; name?: string; content?: string }>;
declare namespace RouteB { interface MetaArgs { params: Record<string, string> } }

export function meta(_args: RouteB.MetaArgs) {
  return appMetaTags('Inbox');
}
