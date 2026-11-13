const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'docs/security-remediation-2026-11-13');
fs.mkdirSync(out, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/DATABASE|REDIS|RABBITMQ|SUPABASE|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|SERVICE_ACCOUNT|API_KEY/i.test(key)));
const results = [];
for (const workspace of require(path.join(root, 'package.json')).workspaces) {
  const json = path.join(out, `${workspace}-tests.json`);
  const run = spawnSync(process.execPath, [path.join(root, 'node_modules/jest/bin/jest.js'), '--runInBand', '--testPathIgnorePatterns=\\.integration\\.spec\\.ts$', '--json', `--outputFile=${json}`], {
    cwd: path.join(root, workspace), env, encoding: 'utf8', timeout: 240000,
  });
  fs.writeFileSync(path.join(out, `${workspace}-tests.txt`), `${run.stdout || ''}\n${run.stderr || ''}`);
  const data = fs.existsSync(json) ? JSON.parse(fs.readFileSync(json)) : {};
  const result = { workspace, exitCode: run.status, passed: data.numPassedTests, failed: data.numFailedTests, suites: data.numTotalTestSuites, success: data.success };
  results.push(result);
  console.log(JSON.stringify(result));
}
fs.writeFileSync(path.join(out, 'unit-summary.json'), `${JSON.stringify(results, null, 2)}\n`);
if (results.some(({ success, exitCode }) => !success || exitCode !== 0)) process.exitCode = 1;
