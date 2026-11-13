module.exports = {
  rootDir: "../..",
  testMatch: [
    "<rootDir>/docs/security-audit-2026-11-12/backend-probes.spec.ts",
  ],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      { tsconfig: "<rootDir>/docs/security-audit-2026-11-12/tsconfig.json" },
    ],
  },
  testEnvironment: "node",
};
