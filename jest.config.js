module.exports = {
  globalSetup: './jest.globalSetup.js',
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.js'],
  testTimeout: 90000,
  testMatch: [
    '<rootDir>/tests/acceptance/**/*.spec.js',
    '<rootDir>/tests/acceptance/**/*.test.js',
    '<rootDir>/tests/functional/**/*.test.js',
    '<rootDir>/tests/unit/**/*.test.js',
    '<rootDir>/tests/integration/**/*.test.js',
    '<rootDir>/tests/e2e/**/*.test.js',
    '<rootDir>/tests/benchmark/**/*.test.js'
  ],
};