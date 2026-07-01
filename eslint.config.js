import globals from 'globals';
import pluginJs from '@eslint/js';
import pluginImport from 'eslint-plugin-import';
import stylisticJs from '@stylistic/eslint-plugin';

export default [
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  pluginJs.configs.recommended,
  pluginImport.flatConfigs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      '@stylistic/js': stylisticJs,
    },
    rules: {
      'semi': 'error',
      'comma-dangle': ['error', 'always-multiline'],
      'quotes': ['error', 'single'],
      'max-len': [
        'error',
        {
          'code': 120,
          'tabWidth': 2,
          'ignoreComments': true,
          'ignoreTrailingComments': true,
          'ignoreStrings': true,
          'ignoreUrls': true,
          'ignoreTemplateLiterals': true,
          'ignoreRegExpLiterals': true,
        },
      ],
      'object-curly-spacing': ['error', 'always'],
      'no-trailing-spaces': 'error',
      'import/no-cycle': 'warn',
      'import/first': ['error', 'absolute-first'],
    },
  },
];
