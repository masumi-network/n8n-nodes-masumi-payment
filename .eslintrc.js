module.exports = {
	root: true,
	env: {
		browser: true,
		es6: true,
		node: true,
	},
	parser: '@typescript-eslint/parser',
	parserOptions: {
		ecmaVersion: 2020,
		sourceType: 'module',
	},
	plugins: ['@typescript-eslint', 'n8n-nodes-base'],
	extends: [
		'eslint:recommended',
		'plugin:n8n-nodes-base/nodes',
		'plugin:n8n-nodes-base/credentials',
		'plugin:n8n-nodes-base/community',
	],
	rules: {
		'no-unused-vars': 'off',
		'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		'no-console': 'off', // Allow console statements for debugging
		'no-undef': 'off', // TypeScript handles this
	},
	ignorePatterns: [
		'dist/**',
		'node_modules/**',
		'*.js',
		'temp/**',
		'tests/**',
	],
};