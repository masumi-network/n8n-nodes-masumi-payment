module.exports = {
	root: true,
	env: {
		browser: true,
		es6: true,
		node: true,
	},
	parserOptions: {
		ecmaVersion: 2020,
		sourceType: 'module',
	},
	plugins: [],
	extends: [
		'eslint:recommended',
	],
	rules: {
		'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		'no-console': 'warn',
	},
	ignorePatterns: [
		'dist/**',
		'node_modules/**',
		'*.js',
	],
};