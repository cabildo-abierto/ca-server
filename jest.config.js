// jest.config.js

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    // Use the ts-jest preset to enable TypeScript support
    preset: 'ts-jest',

    // The environment in which the tests will be run. 'node' is essential for backend testing.
    testEnvironment: 'node',

    // A glob pattern to find test files. This looks for any .test.ts or .spec.ts files.
    testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],

    // Automatically clear mock calls, instances, and results before every test.
    // This is a good practice to prevent tests from influencing each other.
    clearMocks: true,
    transform: {
        // Use ts-jest for any file ending in .ts or .js
        '^.+\\.[tj]s$': 'ts-jest',
    },

    // A list of paths to modules that run some code to configure or set up the
    // testing framework before each test file in the suite is executed.
    // Useful for things like connecting/disconnecting from your test database.
    // setupFilesAfterEnv: ['./src/test/setup.ts'],
    moduleNameMapper: {
        // This line tells Jest to map any import starting with '#/'
        // to the corresponding file inside the '<rootDir>/src/' directory.
        '^#/(.*)$': '<rootDir>/src/$1',
    },
    transformIgnorePatterns: [
        '/node_modules/(?!(@atcute|yocto-queue))',
    ],
};