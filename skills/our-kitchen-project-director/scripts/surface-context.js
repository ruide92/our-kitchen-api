#!/usr/bin/env node
// Surface Context — load registry + journeys for a given surface ID or page
// Usage: node skills/our-kitchen-project-director/scripts/surface-context.js [surface-id|page-name]
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const REGISTRY_PATH = path.join(ROOT, 'governance', 'product-surfaces.json');
const JOURNEY_PATH = path.join(ROOT, 'docs', 'USER_JOURNEY_ACCEPTANCE.md');

function main() {
  const query = process.argv[2];
  if (!query) {
    console.log('Usage: node surface-context.js [surface-id|page-name]');
    console.log('Example: node surface-context.js MENU-01');
    console.log('Example: node surface-context.js fridge');
    process.exit(1);
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const surfaces = registry.surfaces || [];

  // Find matching surfaces
  const matches = surfaces.filter(s =>
    s.id?.toLowerCase().includes(query.toLowerCase()) ||
    s.page?.toLowerCase() === query.toLowerCase() ||
    s.label?.toLowerCase().includes(query.toLowerCase())
  );

  if (matches.length === 0) {
    console.log(`No surfaces found for: ${query}`);
    process.exit(1);
  }

  console.log(`=== Surface Context: ${query} ===`);
  console.log(`Matches: ${matches.length}\n`);

  for (const s of matches) {
    console.log(`[${s.id}] ${s.label || s.handler || s.page}`);
    console.log(`  Page: ${s.page}`);
    console.log(`  Kind: ${s.kind}`);
    if (s.handler) console.log(`  Handler: ${s.handler}`);
    if (s.action) console.log(`  Action: ${s.action}`);
    if (s.surface_id) console.log(`  Surface ID: ${s.surface_id}`);
    console.log(`  Status: ${s.status}`);
    console.log(`  Final: ${s.final}`);
    if (s.journey) console.log(`  Journey: ${s.journey}`);
    if (s.api) console.log(`  API: ${s.api}`);
    if (s.backend) console.log(`  Backend: ${s.backend}`);
    if (s.db) console.log(`  DB: ${s.db}`);
    if (s.acceptance) console.log(`  Acceptance: ${s.acceptance}`);
    console.log('');
  }

  // Status summary
  const byStatus = {};
  for (const s of matches) {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
  }
  console.log('--- Status summary ---');
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${count}`);
  }
}

main();
