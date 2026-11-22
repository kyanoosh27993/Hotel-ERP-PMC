/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test/unit'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@hotel-erp/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@hotel-erp/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
  },
};
