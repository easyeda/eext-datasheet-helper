import antfu from '@antfu/eslint-config';

export default antfu({
	stylistic: {
		indent: 'tab',
		quotes: 'single',
		semi: true,
	},

	typescript: true,

	ignores: ['build/dist/', 'coverage/', 'dist/', 'node_modules/', '.eslintcache', 'debug.log', 'iframe/assets/**', 'iframe/local.js', 'iframe/local-worker.txt', 'test-results/**', 'iframe/app.js'],
}, {
	files: ['iframe/mode.js'],
	languageOptions: { globals: { eda: 'readonly' } },
}, {
	files: ['tests/**'],
	rules: { 'antfu/no-top-level-await': 'off', 'no-console': 'off', 'test/no-import-node-test': 'off' },
});
