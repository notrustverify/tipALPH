module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ["**/?(*.)+(spec|test).ts"],
    testPathIgnorePatterns: [".*/node_modules/", ".*/templates/.*"],
    transform: { '\\.[jt]s?$': ['ts-jest', { tsconfig: { allowJs: true } }] },
    moduleNameMapper: { '^(\\.{1,2}/.*)\\.[jt]s$': '$1', },
    collectCoverage: false,
    coverageDirectory: "./coverage/",
    collectCoverageFrom: [
        "./src/**/*.ts",
        "!**/node-modules/**"
    ],
  };