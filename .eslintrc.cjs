/** eslint config مشترک مونوریپو (پیش‌فرض جستجوی بالادست) */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  env: { node: true, es2022: true, jest: true },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off', // با بازبینی کد کنترل می‌شود (فاز ۱)
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-non-null-assertion': 'off',
    'no-undef': 'off', // TS مسئول است
  },
  ignorePatterns: ['dist/', 'build/', 'node_modules/', '*.js', 'graphify-out/', 'apps/web/'],
};
