// Prepares only the named disposable localhost test database; never reads .env.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Pool } = require("pg");

const root = path.resolve(__dirname, "../..");
const baseUrl = "postgresql://messaging_test:messaging_test@127.0.0.1:55439/";
const databaseUrl = `${baseUrl}messaging_flows_test`;

async function prepare() {
  const admin = new Pool({ connectionString: `${baseUrl}messaging_test` });
  try {
    const identity = await admin.query(
      "SELECT current_database() AS name, current_user AS owner",
    );
    assert.deepEqual(identity.rows[0], {
      name: "messaging_test",
      owner: "messaging_test",
    });
    if (
      !(
        await admin.query(
          "SELECT 1 FROM pg_database WHERE datname='messaging_flows_test'",
        )
      ).rowCount
    )
      await admin.query("CREATE DATABASE messaging_flows_test");
  } finally {
    await admin.end();
  }
  const db = new Pool({ connectionString: databaseUrl });
  try {
    await db.query(
      "CREATE TABLE IF NOT EXISTS public.messaging_flow_migrations(name text PRIMARY KEY)",
    );
    const directory = path.join(root, "prisma/migrations");
    const migrations = fs
      .readdirSync(directory)
      .filter((name) => /^\d+_/.test(name))
      .sort((a, b) => parseInt(a) - parseInt(b));
    for (const name of migrations) {
      if (
        (
          await db.query(
            "SELECT 1 FROM public.messaging_flow_migrations WHERE name=$1",
            [name],
          )
        ).rowCount
      )
        continue;
      await db.query("BEGIN");
      try {
        await db.query(
          fs.readFileSync(path.join(directory, name, "migration.sql"), "utf8"),
        );
        await db.query(
          "INSERT INTO public.messaging_flow_migrations VALUES ($1)",
          [name],
        );
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      }
    }
    // The broker fixture creates parent roles before migration 34; mirror its LOGIN attribute too.
    for (const service of [
      "authentication",
      "user",
      "property",
      "chat",
      "payment",
      "notification",
    ])
      await db.query(`ALTER ROLE ${service}_service LOGIN BYPASSRLS`);
  } finally {
    await db.end();
  }
}

async function main() {
  await prepare();
  const env = {
    ...process.env,
    TEST_DATABASE_URL: databaseUrl,
    FEED_TEST_DATABASE_URL: databaseUrl,
    TAKEOVER_TEST_DATABASE_URL: databaseUrl,
  };
  for (const [workspace, tests] of [
    ["payment", ["src/payments/subscription.integration.spec.ts"]],
    [
      "property",
      [
        "src/feed/feed.integration.spec.ts",
        "src/properties/takeover.integration.spec.ts",
      ],
    ],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        require.resolve("jest/bin/jest"),
        "--runInBand",
        "--runTestsByPath",
        ...tests,
      ],
      { cwd: path.join(root, workspace), env, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${workspace} persisted flow tests failed`);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
