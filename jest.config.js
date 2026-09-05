/**
 * Two projects, because the suite has two kinds of test with genuinely
 * different needs.
 *
 * `node` is everything that existed before Phase 4: pure functions, no DOM,
 * relative imports. Fast, and it stays that way — a jsdom environment costs
 * real time per suite and none of those tests need one.
 *
 * `dom` is component tests, added because the audit called rebuilding the
 * guest upload flow with no component tests the one genuinely risky part of
 * the redesign. It resolves `@/` because components import that way, which the
 * node project deliberately does not: pure tests import relatively so the
 * alias can never mask a file that moved.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  projects: [
    {
      displayName: 'node',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['**/__tests__/**/*.test.ts'],
    },
    {
      displayName: 'dom',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      testMatch: ['**/__tests__/**/*.test.tsx'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.dom.ts'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
        // Stylesheets carry no behaviour worth asserting and jsdom cannot
        // parse them.
        '\\.(css|scss)$': '<rootDir>/__tests__/helpers/styleStub.js',
      },
    },
  ],
};
