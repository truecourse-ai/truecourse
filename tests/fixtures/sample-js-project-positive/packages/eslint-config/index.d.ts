declare const config: import('./types').EslintConfig;
export { config };


// index.d.ts exporting 'config' from a config package — standard declaration file, no class to match filename
declare const baseConfig: import('./types').EslintConfig;
declare const strictConfig: import('./types').EslintConfig;
export { baseConfig, strictConfig };

