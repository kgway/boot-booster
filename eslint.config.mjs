import obsidianmd from 'eslint-plugin-obsidianmd';
import json from '@eslint/json';

// Audit the runtime and manifest. Build tools and synthetic host mocks have
// different environments and are covered by their own checks.
export default [
  { ignores: ['**/*', '!src/', '!src/**', '!manifest.json'] },
  ...obsidianmd.configs.recommended.map(config => ({
    ...config,
    files: config.files ? config.files.map(glob => [...(Array.isArray(glob) ? glob : [glob]), 'src/**/*.ts']) : ['src/**/*.ts'],
  })),
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ['manifest.json'], plugins: { json }, language: 'json/json', rules: json.configs.recommended.rules },
];
