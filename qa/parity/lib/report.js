'use strict';
const { shapeDifferences } = require('./shape');

const MAX_DIFF_LINES = 6;

/** How two runs of the same case differ: outcome, then each request's status and response shape. */
function compareCase(caseDef, a, b) {
  const lines = [];
  if (a.status !== b.status) lines.push(`outcome: ${a.status} vs ${b.status}`);
  if (a.status === 'skip' || b.status === 'skip' || caseDef.parity === 'outcome') return lines;

  if (a.steps.length !== b.steps.length) {
    lines.push(`requests made: ${a.steps.length} vs ${b.steps.length}`);
  }
  const count = Math.min(a.steps.length, b.steps.length);
  for (let i = 0; i < count; i += 1) {
    const x = a.steps[i];
    const y = b.steps[i];
    const where = `${x.label} (as ${x.as})`;
    if (x.label !== y.label || x.as !== y.as) {
      lines.push(`step ${i + 1}: "${where}" vs "${y.label} (as ${y.as})"`);
      break;
    }
    if (x.status !== y.status) lines.push(`${where}: status ${x.status} vs ${y.status}`);
    else lines.push(...shapeDifferences(x.shape, y.shape).map((d) => `${where}: ${d}`));
  }
  return lines;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
}

function tally(run) {
  const count = (status) => run.results.filter((r) => r.status === status).length;
  const steps = run.results.flatMap((r) => r.steps).filter((s) => typeof s.ms === 'number' && s.ms > 0);
  return {
    pass: count('pass'),
    fail: count('fail'),
    skip: count('skip'),
    error: count('error'),
    requests: steps.length,
    medianMs: median(steps.map((s) => s.ms)),
    p95Ms: [...steps.map((s) => s.ms)].sort((x, y) => x - y)[Math.floor(steps.length * 0.95)] ?? 0,
  };
}

function cell(status) {
  return { pass: 'pass', fail: '**FAIL**', skip: 'skipped', error: '**ERROR**' }[status] ?? status;
}

function escape(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function phnomPenhTime(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Phnom_Penh',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/** The comparison of every case across the runs given (one or two). */
function compare(runs, cases) {
  return cases.map((caseDef) => {
    const results = runs.map((run) => run.results.find((r) => r.id === caseDef.id));
    const differences = runs.length === 2 && results[0] && results[1] ? compareCase(caseDef, results[0], results[1]) : [];
    return { id: caseDef.id, area: caseDef.area, title: caseDef.title, known: caseDef.known ?? null, results, differences };
  });
}

function verdictLines(runs, comparison, tallies) {
  const allPass = tallies.every((t) => t.fail === 0 && t.error === 0 && t.skip === 0);
  const same = comparison.every((c) => c.differences.length === 0);
  const lines = ['## Verdict', ''];
  if (runs.length === 2) {
    lines.push(`- **Production and staging behave the same: ${same ? 'YES' : 'NO'}** (${comparison.filter((c) => c.differences.length > 0).length} of ${comparison.length} use cases differ)`);
  }
  lines.push(`- **Every use case passes: ${allPass ? 'YES' : 'NO'}**`, '');
  lines.push(`| | ${runs.map((r) => r.env).join(' | ')} |`, `|---|${runs.map(() => '---').join('|')}|`);
  const row = (name, pick) => lines.push(`| ${name} | ${tallies.map(pick).join(' | ')} |`);
  row('Passed', (t) => t.pass);
  row('Failed', (t) => t.fail);
  row('Errors (crashed case)', (t) => t.error);
  row('Skipped (an earlier case failed)', (t) => t.skip);
  row('Requests made', (t) => t.requests);
  row('Median response', (t) => `${t.medianMs} ms`);
  row('95th percentile response', (t) => `${t.p95Ms} ms`);
  row('Run time', (_, i) => `${Math.round(runs[i].durationMs / 1000)} s`);
  lines.push(`| Network retries | ${runs.map((r) => r.retries.length).join(' | ')} |`);
  lines.push(`| Gateway | ${runs.map((r) => r.baseUrl).join(' | ')} |`, '');
  return { lines, ok: allPass && same };
}

function differenceLines(comparison) {
  const differing = comparison.filter((c) => c.differences.length > 0);
  if (differing.length === 0) return [];
  const lines = ['## Where production and staging differ', ''];
  for (const c of differing) {
    lines.push(`### ${c.id} ${c.title}`);
    for (const d of c.differences.slice(0, MAX_DIFF_LINES)) lines.push(`- ${d}`);
    if (c.differences.length > MAX_DIFF_LINES) lines.push(`- ...and ${c.differences.length - MAX_DIFF_LINES} more (see the .json)`);
    lines.push('');
  }
  return lines;
}

function failureLines(runs) {
  const lines = [];
  for (const run of runs) {
    const bad = run.results.filter((r) => r.status !== 'pass');
    if (bad.length === 0) continue;
    lines.push(`## What failed on ${run.env}`, '');
    for (const r of bad) {
      lines.push(`- **${r.id}** ${r.title} — ${cell(r.status)}`);
      for (const f of r.failures) lines.push(`  - ${escape(f)}`);
    }
    lines.push('');
  }
  return lines;
}

function tableLines(runs, comparison) {
  const lines = ['## Every use case', ''];
  const parityColumn = runs.length === 2 ? ' Same on both? |' : '';
  lines.push(`| ID | Area | Use case | ${runs.map((r) => r.env).join(' | ')} |${parityColumn}`);
  lines.push(`|---|---|---|${runs.map(() => '---').join('|')}|${runs.length === 2 ? '---|' : ''}`);
  for (const c of comparison) {
    const same = runs.length === 2 ? ` ${c.differences.length === 0 ? 'same' : '**different**'} |` : '';
    const title = c.known ? `${c.title} _(known gap: ${c.known})_` : c.title;
    lines.push(`| ${c.id} | ${c.area} | ${escape(title)} | ${c.results.map((r) => (r ? cell(r.status) : '-')).join(' | ')} |${same}`);
  }
  return lines;
}

function noteLines(runs) {
  const lines = [];
  for (const run of runs) {
    const noted = run.results.filter((r) => r.notes.length > 0);
    const retries = run.retries;
    if (noted.length === 0 && retries.length === 0) continue;
    lines.push('', `## Notes from ${run.env}`, '');
    for (const r of noted) for (const n of r.notes) lines.push(`- ${r.id}: ${escape(n)}`);
    for (const r of retries) lines.push(`- network retry: ${escape(r)}`);
  }
  return lines;
}

function buildReport(runs, cases) {
  const comparison = compare(runs, cases);
  const tallies = runs.map(tally);
  const verdict = verdictLines(runs, comparison, tallies);
  const markdown = [
    `# Tilomnov end-to-end use-case test${runs.length === 2 ? ': production vs staging' : `: ${runs[0].env}`}`,
    '',
    `Run ${phnomPenhTime(new Date(runs[0].startedAt))} (Phnom Penh time). ${cases.length} use cases, each run on ${runs.map((r) => r.env).join(' and ')} through the public gateway, as the app calls it. "Same" means the same outcome, the same status for every request and the same response fields and types; values (ids, dates, other people's listings) are not compared.`,
    '',
    ...verdict.lines,
    ...differenceLines(comparison),
    ...failureLines(runs),
    ...tableLines(runs, comparison),
    ...noteLines(runs),
    '',
  ].join('\n');
  const summary = runs
    .map((run, i) => `${run.env}: ${tallies[i].pass} passed, ${tallies[i].fail} failed, ${tallies[i].error} errors, ${tallies[i].skip} skipped`)
    .concat(runs.length === 2 ? [`Differences between them: ${comparison.filter((c) => c.differences.length > 0).length}`] : [])
    .join('\n');
  return { markdown, summary, comparison, ok: verdict.ok };
}

module.exports = { buildReport };
