// remix-route-module: re-export shim for a nested route — not a Node.js process entry point
declare const WebhookDetailPage: React.ComponentType<{ loaderData: unknown }>;
declare const meta: (args: unknown) => { title: string }[];

export { meta };
export default WebhookDetailPage;
