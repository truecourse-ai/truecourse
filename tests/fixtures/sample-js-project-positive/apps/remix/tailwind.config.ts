
// Shape: path.join(require.resolve('@pkg/ui'), '..') — both are string returns, no type mismatch
declare const path: { join(...parts: string[]): string };
declare function require(id: string): { resolve(id: string): string };

const uiPackagePath = path.join(require('@acme/ui').resolve('@acme/ui'), '..');
const emailPackagePath = path.join(require('@acme/email').resolve('@acme/email'), '..');
const iconsPackagePath = path.join(require('@acme/icons').resolve('@acme/icons'), '..');

export const contentPaths = [
  `${uiPackagePath}/components/**/*.{ts,tsx}`,
  `${emailPackagePath}/templates/**/*.{ts,tsx}`,
  `${iconsPackagePath}/src/**/*.{ts,tsx}`,
];


// --- argument-type-mismatch FP: path.join(require.resolve('@pkg'), '..') — require.resolve returns string; no type mismatch ---
declare const path: { join(...parts: string[]): string };
declare function requireResolve(id: string): string;

const sharedUiContentPaths = [
  `${path.join(requireResolve('@acme/ui'), '..')}/components/**/*.{ts,tsx}`,
  `${path.join(requireResolve('@acme/ui'), '..')}/primitives/**/*.{ts,tsx}`,
  `${path.join(requireResolve('@acme/email'), '..')}/templates/**/*.{ts,tsx}`,
];



/* eslint-disable @typescript-eslint/no-var-requires */
const baseThemeConfig = require('@workspace/ui/tailwind.config.cjs');
const nodePath = require('path');

module.exports = {
  presets: [baseThemeConfig],
  content: [
    './app/**/*.{ts,tsx}',
    `${nodePath.join(require.resolve('@workspace/ui'), '..')}/components/**/*.{ts,tsx}`,
  ],
  theme: {
    extend: {},
  },
};
