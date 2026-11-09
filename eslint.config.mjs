// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  rules: {
    'vue/no-multiple-template-root': 'off',
    'vue/max-attributes-per-line': ['error', { singleline: 3 }]
  }
}, {
  // Testes: dublês e stubs precisam de `any`, classes vazias e linhas compactas.
  files: ['tests/**/*.ts', 'vitest.config.ts', 'playwright.config.ts'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-extraneous-class': 'off',
    '@stylistic/max-statements-per-line': 'off'
  }
})
