'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ENVIRONMENTS } = require('./lib/config');
const { runEnvironment } = require('./lib/runner');
const { buildReport } = require('./lib/report');
const cases = require('./cases');

const USAGE = `Usage: node run.js <staging|production> [<staging|production>] [--only=ID,ID]

  node run.js staging production   run both, then compare them (the parity report)
  node run.js staging              run one environment only`;

function parseArgs(argv) {
  const envNames = argv.filter((arg) => !arg.startsWith('--'));
  const only = argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length).split(',');
  if (envNames.length === 0 || envNames.some((name) => !ENVIRONMENTS[name])) {
    console.error(USAGE);
    process.exit(2);
  }
  return { envs: envNames.map((name) => ENVIRONMENTS[name]), only };
}

function selectCases(only) {
  if (!only) return cases;
  // Sign-in, clean-up and sign-out always run: the other cases need them.
  const always = new Set(['AUTH-01', 'SETUP-01', 'END-01', 'END-02', 'END-99']);
  return cases.filter((c) => always.has(c.id) || only.includes(c.id));
}

function stamp(date) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function main() {
  const { envs, only } = parseArgs(process.argv.slice(2));
  const selected = selectCases(only);
  const runs = [];
  for (const env of envs) runs.push(await runEnvironment(env, selected));

  const report = buildReport(runs, selected);
  const dir = path.join(__dirname, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${stamp(new Date())}-${envs.map((e) => e.name).join('-vs-')}`);
  fs.writeFileSync(`${base}.md`, report.markdown);
  fs.writeFileSync(`${base}.json`, JSON.stringify({ runs, comparison: report.comparison }, null, 2));

  console.log(`\n${report.summary}`);
  console.log(`Report: ${base}.md`);
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(3);
});
