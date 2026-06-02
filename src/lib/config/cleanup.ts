import fs from 'fs';
import path from 'path';

// One-shot startup cleanup: strip the stale `modelProviders` key from
// data/config.json if a previous version left it there. Phase 1
// deliberately did NOT rewrite config.json so a rollback would still find
// the seed source intact. Phase 3 has now flipped reads to the DB, so the
// stale key is misleading at best and confusing at worst (an operator who
// hand-edits modelProviders in config.json would expect their change to
// take effect, which it does not anymore).
//
// Idempotent: re-runs are no-ops because the second read does not contain
// the key. Safe on a partial-state file (someone running an older binary
// that still wrote modelProviders after we removed the in-memory default):
// we just strip it again on the next boot.
export function stripStaleModelProvidersKey(): void {
  const dataDir = process.env.DATA_DIR || process.cwd();
  const configPath = path.join(dataDir, 'data', 'config.json');

  if (!fs.existsSync(configPath)) return;

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    console.warn(
      `config cleanup: could not read ${configPath}, skipping modelProviders strip:`,
      err,
    );
    return;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // A corrupt config.json is handled by ConfigManager's own initializer
    // (it overwrites with defaults). Do not pile on a second rewrite here.
    console.warn(
      'config cleanup: config.json is not valid JSON, leaving alone for ConfigManager to handle',
    );
    return;
  }

  if (!parsed || typeof parsed !== 'object') return;
  if (!('modelProviders' in parsed)) return;

  delete parsed.modelProviders;

  try {
    fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2));
    console.log(
      'config cleanup: removed stale modelProviders key from config.json',
    );
  } catch (err) {
    console.warn(
      `config cleanup: could not rewrite ${configPath} without modelProviders:`,
      err,
    );
  }
}
