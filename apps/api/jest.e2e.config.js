/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test/e2e'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  testRegex: '.*\\.e2e-spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 60000,
  moduleNameMapper: {
    '^@hotel-erp/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@hotel-erp/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
  },
};
