
// Wave-M02: path.resolve in a Vite/build alias config object — returns string, no type mismatch
declare const path: { resolve: (...args: string[]) => string };
declare const __dirname: string;

const buildAliases = {
  https: 'node:https',
  canvas: path.resolve(__dirname, './src/empty-module.ts'),
  'some-native': path.resolve(__dirname, '../../node_modules/some-native/index.js'),
};



// Wave-M31: path.join(__dirname, '../' + file) — string concatenation produces valid path string
declare const path: { join: (...parts: string[]) => string };
declare const __dirname: string;

const CONFIG_FILES = ['.env', '.env.local', '.env.development'];

CONFIG_FILES.forEach((file) => {
  const filePath = path.join(__dirname, '../../' + file);
  console.log('Loading config from:', filePath);
});
