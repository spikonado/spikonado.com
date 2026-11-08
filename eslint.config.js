import { defineConfig, includeIgnoreFile } from 'eslint/config';
import eslintPluginAstro from 'eslint-plugin-astro';
import globals from 'globals';
import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import path from 'node:path';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	...ts.configs.recommended,
	prettier,
	...eslintPluginAstro.configs.recommended,
	...eslintPluginAstro.configs['jsx-a11y-recommended'],
	{
		files: ['**/*.tsx'],
		...jsxA11y.flatConfigs.recommended
	},
	{
		files: ['**/*.tsx'],
		...reactHooks.configs.flat.recommended
	},
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	}
);
