// Rotates every secret that is due. Run daily by .github/workflows/secret-rotation.yml.
//
//   node scripts/secret-rotation/run.js              rotate what is due
//   node scripts/secret-rotation/run.js --dry-run    only say what is due
//   node scripts/secret-rotation/run.js --force --only=chat,shared
//
// Settings (environment): INFISICAL_API_URL, INFISICAL_PROJECT_ID,
// INFISICAL_ENVIRONMENT, INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET,
// SECRET_ROTATION_DAYS (default 30). See docs/SECRET_ROTATION.md.
const { connectTo, infisicalFromEnv, wait } = require('./environment');
const { ROTATION_PATH, SERVICES, rotatedAtKey } = require('./layout');
const { rotateDatabaseLogin } = require('./rotate-database');
const { rotateSharedSecrets } = require('./rotate-shared');
const { railwayHandoverFromEnv } = require('./railway-handover');
const { bootstrapIfNeeded } = require('./bootstrap');

const DAY_MS = 24 * 60 * 60 * 1000;

function options(argv) {
  const only = argv.find((arg) => arg.startsWith('--only='));
  return {
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
    only: only ? only.slice('--only='.length).split(',') : null,
  };
}

/** Whether `name` last rotated at least `days` ago. Never rotated counts as due. */
async function isDue(secrets, name, days, now) {
  const last = await secrets.get(ROTATION_PATH, rotatedAtKey(name));
  const time = last ? Date.parse(last) : NaN;
  return Number.isNaN(time) || now.getTime() - time >= days * DAY_MS;
}

async function main() {
  const { dryRun, force, only } = options(process.argv.slice(2));
  const days = Number(process.env.SECRET_ROTATION_DAYS || 30);
  const now = new Date();
  const secrets = await infisicalFromEnv();
  const handover = dryRun ? null : railwayHandoverFromEnv();
  if (handover) await handover.preflight(secrets);

  const tasks = [
    ...SERVICES.map((service) => ({
      name: service,
      run: async () => {
        if (process.argv.includes('--bootstrap')) {
          await bootstrapIfNeeded({ service, secrets, connect: connectTo, wait, handover,
            adminUrl: process.env.ADMIN_DATABASE_URL, now });
        }
        const login = await rotateDatabaseLogin({ service, secrets, connect: connectTo, wait, now });
        await handover.waitFor([service], { DATABASE_URL: await secrets.get(`/${service}`, 'DATABASE_URL') });
        return `now on ${login}`;
      },
    })),
    { name: 'shared', run: () => rotateSharedSecrets({ secrets, handover, now }).then(() => 'rotated') },
  ].filter((task) => !only || only.includes(task.name));

  let failures = 0;
  for (const task of tasks) {
    try {
      if (!force && !(await isDue(secrets, task.name, days, now))) {
        console.log(`${task.name}: not due`);
        continue;
      }
      if (dryRun) {
        console.log(`${task.name}: due`);
        continue;
      }
      console.log(`${task.name}: ${await task.run()}`);
    } catch (error) {
      failures++;
      console.log(`::error::${task.name}: ${error.message}`);
      break; // Keep later credentials unchanged when a handover did not finish.
    }
  }
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.log(`::error::${error.message}`);
  process.exit(1);
});
