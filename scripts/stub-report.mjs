import { writeFileSync, existsSync } from 'node:fs';
const path = new URL('../src/competition_report.json', import.meta.url).pathname;
if (!existsSync(path)) {
  writeFileSync(path, JSON.stringify({ users: [], matches: [], highScores: [] }));
  console.log('Stub report written to', path);
} else {
  console.log('Real report already present, not stubbing');
}
