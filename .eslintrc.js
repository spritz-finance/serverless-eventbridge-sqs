module.exports = {
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: {
    commonjs: true,
    browser: true,
    jest: true,
    es2020: true
  },
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
  },
  "rules": {
    "@typescript-eslint/no-explicit-any": "off"
  }
};
