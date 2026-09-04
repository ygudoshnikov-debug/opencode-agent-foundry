/**
 * Presets are checked against OpenCode's own model catalogue.
 *
 * A preset is a promise that picking it produces a working, sensible team. The
 * ways that promise breaks are all silent: a misspelled id fails at the first
 * dispatch, an alpha build disappears, a ladder that puts the flagship on the
 * role that runs most quietly triples the bill, and a pick that was current
 * when it was written goes stale as vendors ship. None of those show up in a
 * typecheck or a unit test, so they are checked here against real data.
 *
 * The catalogue is the copy OpenCode caches locally. When it is absent (a fresh
 * machine, or CI), this reports and exits 0: it can only verify what it can
 * read, and a missing cache is not a broken preset.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CATALOGUE = process.env.OPENCODE_MODELS_JSON ?? join(homedir(), '.cache', 'opencode', 'models.json');
const ROLES = ['architect', 'lead', 'analyst', 'builder'];

/** Builds that are fine to experiment with and wrong to ship to someone else. */
const UNSTABLE = /(^|[-_])(alpha|beta|preview|exp|experimental|free|contributor|nightly|latest)([-_]|$)/i;

const { PRESETS, ACKNOWLEDGED } = await import(
  pathToFileURL(join(process.cwd(), 'dist', 'config', 'presets.js')).href,
);

if (!existsSync(CATALOGUE)) {
  console.log(`No OpenCode model catalogue at ${CATALOGUE} — skipping preset verification.`);
  process.exit(0);
}

const raw = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const models = new Map();
const newestPerProvider = new Map();
for (const [providerID, provider] of Object.entries(raw)) {
  for (const [modelID, model] of Object.entries(provider?.models ?? {})) {
    const release = model.release_date ?? '';
    models.set(`${providerID}/${modelID}`, {
      release,
      input: model.cost?.input ?? 0,
      output: model.cost?.output ?? 0,
    });
    if (release > (newestPerProvider.get(providerID) ?? '')) newestPerProvider.set(providerID, release);
  }
}

console.log(`catalogue: ${models.size} models across ${Object.keys(raw).length} providers\n`);

const errors = [];
const warnings = [];
const acknowledged = [];

for (const preset of PRESETS) {
  console.log(`${preset.label} (${preset.id})`);
  let previousCost = Infinity;

  for (const role of ROLES) {
    const candidates = preset.roles[role] ?? [];
    if (!candidates.length) {
      errors.push(`${preset.id}.${role}: no candidates`);
      continue;
    }

    const [primary, ...fallbacks] = candidates;
    const info = models.get(primary);

    if (!info) {
      errors.push(`${preset.id}.${role}: primary "${primary}" is not in the catalogue`);
      console.log(`  ${role.padEnd(10)} ${primary}  <-- UNKNOWN`);
      continue;
    }

    // Weight by output price: reasoning models bill their thinking as output,
    // so it tracks the capability tier far better than the input rate.
    const cost = info.output;
    const provider = primary.slice(0, primary.indexOf('/'));
    const newest = newestPerProvider.get(provider) ?? '';
    const stale = newest && info.release && info.release < newest ? ` (newest here: ${newest})` : '';

    console.log(`  ${role.padEnd(10)} ${primary.padEnd(40)} ${info.release}  $${info.output}/Mtok out${stale}`);

    if (UNSTABLE.test(primary.slice(primary.indexOf('/') + 1))) {
      const reason = ACKNOWLEDGED[primary];
      if (reason) acknowledged.push(`${preset.id}.${role}: ${primary} is a preview build — ${reason}`);
      else errors.push(`${preset.id}.${role}: "${primary}" is an unstable build and cannot be a default`);
    }

    // The ladder: capability, and therefore price, must not climb as the roles
    // get narrower. An inversion means the role that runs most in parallel got
    // the expensive model.
    if (cost > previousCost) {
      const reason = ACKNOWLEDGED[`${preset.id}:${role}`];
      const line = `${preset.id}.${role}: $${cost}/Mtok out after $${previousCost}/Mtok`;
      if (reason) acknowledged.push(`${line} — ${reason}`);
      else errors.push(`${preset.id}: ladder inversion at ${role} — ${line}`);
    }
    previousCost = cost;

    for (const fallback of fallbacks) {
      const alt = models.get(fallback);
      if (!alt) {
        errors.push(`${preset.id}.${role}: fallback "${fallback}" is not in the catalogue`);
        continue;
      }
      // Not an error: a fallback answers "this account cannot reach the
      // primary", and the nearest reachable substitute is sometimes dearer.
      // Worth surfacing, because it means the bill can exceed what the card
      // implies for someone whose account is missing the primary.
      if (alt.output > info.output) {
        warnings.push(
          `${preset.id}.${role}: fallback ${fallback} ($${alt.output}) is dearer than the primary ($${info.output})`,
        );
      }
    }

    if (stale) {
      warnings.push(`${preset.id}.${role}: ${primary} released ${info.release}, provider has ${newest}`);
    }
  }
  console.log();
}

if (acknowledged.length) {
  console.log('Deliberate exceptions (recorded in ACKNOWLEDGED, with a reason):');
  for (const note of acknowledged) console.log(`  - ${note}`);
  console.log();
}

if (warnings.length) {
  console.log('Worth a look (not failures — the newest model is often not the right tier):');
  for (const warning of warnings) console.log(`  - ${warning}`);
  console.log();
}

if (errors.length) {
  console.error(`${errors.length} problem(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  acknowledged.length
    ? `Every preset holds up: ids exist, and the ${acknowledged.length} rule departure(s) above are recorded choices.`
    : 'Every preset: ids exist, no unstable primaries, ladder descends across roles.',
);
