
const baseConfig = require('@acme/ui/tailwind.config.cjs');
const path = require('path');

module.exports = {
  presets: [baseConfig],
  content: [
    './app/**/*.{ts,tsx}',
    `${path.join(require.resolve('@acme/ui'), '..')}/components/**/*.{ts,tsx}`,
    `${path.join(require.resolve('@acme/ui'), '..')}/primitives/**/*.{ts,tsx}`,
    `${path.join(require.resolve('@acme/email'), '..')}/templates/**/*.{ts,tsx}`,
  ],
};
