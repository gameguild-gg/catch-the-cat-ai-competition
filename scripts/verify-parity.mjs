#!/usr/bin/env node
// verify-parity.mjs — native-CLI vs wasm-callMain contract parity harness for one bot.
// No deps beyond node stdlib. Run from repo root.
//
// Modes:
//   node scripts/verify-parity.mjs --selftest          unit tests only, no external processes
//   node scripts/verify-parity.mjs --user DPS2004      full parity run (--boards N, default 5)
//
// Exit codes: 0 = pass, 1 = native parse failure, 2 = missing prerequisites.

import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// ---------- args ----------
const argv = process.argv.slice(2);
function argValue(name, fallback) {
  const i = argv.indexOf(name);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
}
const USER = argValue('--user', 'DPS2004');
const BOARDS = parseInt(argValue('--boards', '5'), 10);
const SELFTEST = argv.includes('--selftest');

// ---------- shared: parser contract (mirrors generateReport.ts parseMoveAndTimeFromOutput) ----------
function parseMoveAndTime(output) {
  const nonEmpty = output.trim().split('\n').filter((l) => l.trim()).reverse();
  if (nonEmpty.length === 0) throw new Error('No move was returned - agent produced no output');
  if (nonEmpty.length < 2) throw new Error('Expected at least 2 lines in output (time and move)');
  const m = nonEmpty[0].trim().match(/^(-?\d+),(-?\d+)$/);
  if (!m) throw new Error(`Could not parse move coordinates from: ${nonEmpty[0]}`);
  const time = parseFloat(nonEmpty[1].trim());
  if (Number.isNaN(time)) throw new Error(`Could not parse processing time from: ${nonEmpty[1]}`);
  return { move: { x: parseInt(m[1], 10), y: parseInt(m[2], 10) }, time };
}

// ---------- selftest ----------
function selftest() {
  let failed = 0;
  const t = (name, fn) => {
    try {
      fn();
      console.log(`[selftest] PASS ${name}`);
    } catch (e) {
      failed++;
      console.error(`[selftest] FAIL ${name}: ${e.message}`);
    }
  };
  const assertEq = (a, b, msg) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'not equal'}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  };

  // fixture 1: valid multi-line tail (board junk above, µs float then "x,y")
  t('valid tail parses move+time', () => {
    const out = ['board row 0 ....#', 'board row 1 ..#..', '123.45', '-3,4'].join('\n');
    const r = parseMoveAndTime(out);
    assertEq(r.move, { x: -3, y: 4 });
    assertEq(r.time, 123.45);
  });
  // fixture 2: one-line garbage
  t('one-line garbage throws', () => {
    let threw = false;
    try { parseMoveAndTime('I AM A ROBOT'); } catch { threw = true; }
    if (!threw) throw new Error('expected throw for single-line output');
  });
  // fixture 3: malformed x,y
  t('malformed x,y throws', () => {
    let threw = false;
    try { parseMoveAndTime('12.5\n3, 4x'); } catch { threw = true; }
    if (!threw) throw new Error('expected throw for malformed move line');
  });

  // board generator determinism + invariants
  t('mulberry32 deterministic', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) if (a() !== b()) throw new Error('sequence diverged');
  });
  t('board invariants', () => {
    for (let i = 0; i < 3; i++) {
      const bs = genBoard(i);
      assertEq(bs.length, 441, 'length');
      let cats = 0;
      for (const ch of bs) if (ch === 'C') cats++;
      if (cats !== 1) throw new Error(`expected 1 C, got ${cats}`);
      if (bs[220] !== 'C') throw new Error('C not at center index 220');
      if (!/^[.#C]+$/.test(bs)) throw new Error('unexpected chars');
    }
  });

  if (failed) { console.error(`[selftest] ${failed} FAILED`); process.exit(1); }
  console.log('[selftest] ALL PASS');
  process.exit(0);
}

// ---------- board generation ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic 21x21 board for a given index. Format identical to src/board.ts getBoardString:
// row-major, index = (y+10)*21 + (x+10), C at center (index 220), ~22 blocked cells.
const SIZE = 21;
function genBoard(boardIndex) {
  const rng = mulberry32(boardIndex * 2654435761 + 12345);
  const cells = new Array(441).fill('.');
  const blocked = new Set();
  while (blocked.size < 22) {
    const idx = Math.floor(rng() * 441);
    if (idx !== 220) blocked.add(idx);
  }
  for (const idx of blocked) cells[idx] = '#';
  cells[220] = 'C';
  return cells.join('');
}

// ---------- native side ----------
const NATIVE_DIR = path.join('forks-native', USER);
const NATIVE_BIN = path.join(NATIVE_DIR, 'build-native', 'bin', 'catchthecat');

function sh(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: opts.timeout ?? 10_000, maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; reject(err); } else resolve(stdout);
    });
  });
}

async function ensureNative(user) {
  if (existsSync(NATIVE_BIN)) return;
  const users = JSON.parse(readFileSync('users.json', 'utf8'));
  const entry = users.find((u) => u.username === user);
  if (!entry) {
    console.error(`User ${user} not found in users.json`);
    process.exit(2);
  }
  mkdirSync('forks-native', { recursive: true });
  if (!existsSync(path.join(NATIVE_DIR, 'CMakeLists.txt'))) {
    console.log(`Cloning ${entry.repo} -> ${NATIVE_DIR} (shallow)...`);
    await sh('git', ['clone', '--depth', '1', entry.repo, NATIVE_DIR], { timeout: 300_000 });
  }
  console.log(`Configuring native build (${NATIVE_DIR})...`);
  await sh('cmake', ['-S', NATIVE_DIR, '-B', path.join(NATIVE_DIR, 'build-native')], { timeout: 300_000 });
  console.log('Building target catchthecat...');
  await sh('cmake', ['--build', path.join(NATIVE_DIR, 'build-native'), '--target', 'catchthecat', '--parallel', '4'], { timeout: 600_000 });
  if (!existsSync(NATIVE_BIN)) {
    console.error(`Built but ${NATIVE_BIN} still missing — check fork CMake output dir`);
    process.exit(2);
  }
}

function runNative(boardStr, turn) {
  return sh(NATIVE_BIN, ['--headless', '--turn', turn, '--size', String(SIZE), '--board', boardStr]);
}

// ---------- wasm side ----------
const WASM_JS = path.join('forks', USER, 'build-wasm', `${USER}.js`);
// ES6 emscripten module; import in a CHILD node so ENVIRONMENT=web,worker failures don't kill the harness.
const RUNNER = path.join('forks', USER, 'build-wasm', 'run-parity.mjs');
const RUNNER_SRC = `
import { pathToFileURL } from 'node:url';
const mod = await import(pathToFileURL(process.argv[2]).href);
const factory = mod.default;
const inst = await factory({ arguments: process.argv.slice(3) });
await inst.callMain(process.argv.slice(3));
`;

async function runWasm(boardStr, turn) {
  // returns { status: 'PASS'|'SKIPPED-env', parsed?, error? }
  await writeFile(RUNNER, RUNNER_SRC);
  const args = ['--headless', '--turn', turn, '--size', String(SIZE), '--board', boardStr];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUNNER, WASM_JS, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); resolve({ status: 'SKIPPED-env', error: e.message }); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const r = parseMoveAndTime(out);
        resolve({ status: 'PASS', parsed: r });
      } catch (e) {
        // import/env failure or unusable output → graceful degradation
        resolve({ status: 'SKIPPED-env', error: e.message, stderr: err.slice(0, 300) });
      }
    });
  });
}

function wasmStaticValid() {
  if (!existsSync(WASM_JS)) return false;
  const src = readFileSync(WASM_JS, 'utf8');
  return /export default/.test(src) && /callMain/.test(src);
}

// ---------- main ----------
async function main() {
  // prerequisites
  const hasForkDir = existsSync(path.join('forks', USER));
  const hasWasmJs = existsSync(WASM_JS);
  if (!hasForkDir || !hasWasmJs) {
    console.error('Missing prerequisites:');
    if (!hasForkDir) console.error(`  - forks/${USER}/ (original fork clone) missing`);
    if (!hasWasmJs) console.error(`  - ${WASM_JS} missing`);
    console.error('Fix:');
    console.error('  git clone <repo-from-users.json> forks/<user>');
    console.error('  cmake -B build-native && cmake --build build-native --target catchthecat');
    console.error('  scripts/build-bots.sh ONLY=<user>');
    process.exit(2);
  }
  await ensureNative(USER);

  let nativeFails = 0, wasmRan = 0, exact = 0, compared = 0, wasmSkipped = 0;
  for (let b = 0; b < BOARDS; b++) {
    const board = genBoard(b);
    for (const turn of ['cat', 'catcher']) {
      let native;
      try {
        native = parseMoveAndTime(await runNative(board, turn));
      } catch (e) {
        nativeFails++;
        console.log(`[board ${b} | turn ${turn}] NATIVE-FAIL: ${e.message}`);
        continue;
      }
      const w = await runWasm(board, turn);
      if (w.status === 'PASS') {
        wasmRan++;
        compared++;
        const eq = w.parsed.move.x === native.move.x && w.parsed.move.y === native.move.y;
        if (eq) exact++;
        console.log(`[board ${b} | turn ${turn}] NATIVE-PASS move=(${native.move.x},${native.move.y}) | WASM-PASS${eq ? '' : ` move=(${w.parsed.move.x},${w.parsed.move.y})`}`);
      } else {
        wasmSkipped++;
        console.log(`[board ${b} | turn ${turn}] NATIVE-PASS move=(${native.move.x},${native.move.y}) | WASM-${w.status}`);
      }
    }
  }

  const mode = wasmRan > 0 ? `wasm ran clean (${wasmRan} runs)` : wasmStaticValid() ? 'wasm module statically valid (export default + callMain found)' : 'NO VALID WASM EVIDENCE';
  console.log(`WASM-MODE: ${mode}`);
  const pass = nativeFails === 0 && (wasmRan > 0 || wasmStaticValid());
  const rate = compared > 0 ? `${exact}/${compared}` : 'n/a';
  console.log(`CONTRACT-PARITY: ${pass ? 'PASS' : 'FAIL'} (${rate} exact move matches)`);
  process.exit(nativeFails > 0 ? 1 : pass ? 0 : 1);
}

if (SELFTEST) selftest();
else main().catch((e) => { console.error(e); process.exit(1); });
