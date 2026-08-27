/**
 * Unit tests for the pure domain logic (availability maths, zod schemas).
 * `rootDir: src` keeps specs next to the code they cover; the mapper mirrors the
 * `@/*` path alias from tsconfig.json.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
