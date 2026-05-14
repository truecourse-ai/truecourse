
// FP shape: path.resolve() with __dirname and relative path — standard Node.js path resolution
declare const path: { resolve: (...parts: string[]) => string };
declare const __dirname: string;

const assetsAlias = path.resolve(__dirname, '../../node_modules/some-package/dist/browser.js');
const staticDir = path.resolve(__dirname, '../public/assets');
