import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', '.test-dist/**', 'coverage/**', '.omx/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
