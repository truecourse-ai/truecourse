declare function require(id: string): unknown;

const baseConfig = require('./shared-base.config.cjs');
const helper = require('node:path');

module.exports = {
  presets: [baseConfig],
  helper,
};
