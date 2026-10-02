// Tournament scheduling + bracket logic for the arena.
//
// Pure, self-contained helpers: round-robin pairings, standings, and a
// double-elimination bracket with byes and a double grand final. Nothing here
// touches workers or React — the Arena drives matches and reports results.

export type TournamentFormat = 'round-robin' | 'double-elimination';
export type BracketKind = 'WB' | 'LB' | 'GF';
export type MatchStatus = 'pending' | 'ready' | 'bye' | 'done';

// ── Shared helpers ─────────────────────────────────────────────────────────

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function nextPowerOfTwo(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(2, n)));
}

/**
 * Standard bracket seed order for `size` (power of two) participants. For size
 * 8 it is [0, 7, 3, 4, 1, 6, 2, 5] so top seeds only meet late. Padding nulls
 * live at the high indices, which places every bye against a real bot.
 */
export function bracketSeedOrder(size: number): number[] {
  let order = [0];
  while (order.length < size) {
    const doubled = order.length * 2;
    const next: number[] = [];
    for (const seed of order) {
      next.push(seed, doubled - 1 - seed);
    }
    order = next;
  }
  return order;
}

/** Shuffled bots padded with `null` byes up to a power of two. */
function seedParticipants(bots: string[], random: () => number): (string | null)[] {
  const shuffled = shuffle(bots, random);
  const size = nextPowerOfTwo(shuffled.length);
  const seeds: (string | null)[] = [...shuffled];
  while (seeds.length < size) seeds.push(null);
  return seeds;
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

// ── Round robin ────────────────────────────────────────────────────────────

export interface RoundRobinPairing {
  /** Bot playing as the cat. */
  cat: string;
  /** Bot playing as the catcher. */
  catcher: string;
}

/**
 * Single round-robin: every unordered pair meets exactly once, with the cat
 * role alternated so the asymmetric roles stay balanced.
 */
export function roundRobinPairings(bots: string[]): RoundRobinPairing[] {
  const pairings: RoundRobinPairing[] = [];
  for (let i = 0; i < bots.length; i += 1) {
    for (let j = i + 1; j < bots.length; j += 1) {
      const swap = (i + j) % 2 === 1;
      pairings.push({
        cat: swap ? bots[j] : bots[i],
        catcher: swap ? bots[i] : bots[j],
      });
    }
  }
  return pairings;
}

export interface Standing {
  bot: string;
  wins: number;
  losses: number;
  points: number;
}

export function createStandings(bots: string[]): Standing[] {
  return sortStandings(bots.map((bot) => ({ bot, wins: 0, losses: 0, points: 0 })));
}

export function applyStandingResult(standings: Standing[], winner: string, loser: string): Standing[] {
  const next = standings.map((s) => {
    if (s.bot === winner) return { ...s, wins: s.wins + 1, points: s.points + 3 };
    if (s.bot === loser) return { ...s, losses: s.losses + 1 };
    return s;
  });
  return sortStandings(next);
}

function sortStandings(standings: Standing[]): Standing[] {
  return [...standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.bot.localeCompare(b.bot);
  });
}

// ── Double elimination ─────────────────────────────────────────────────────

type SlotSource =
  | { kind: 'seed'; index: number }
  | { kind: 'winner'; matchId: string }
  | { kind: 'loser'; matchId: string };

interface MatchRef {
  matchId: string;
  slot: 'a' | 'b';
}

export interface TournamentMatch {
  id: string;
  bracket: BracketKind;
  round: number;
  index: number;
  source: [SlotSource, SlotSource];
  a: string | null;
  b: string | null;
  winner: string | null;
  loser: string | null;
  status: MatchStatus;
  nextWinner: MatchRef | null;
  nextLoser: MatchRef | null;
}

export interface Tournament {
  size: number;
  seeds: (string | null)[];
  wb: TournamentMatch[][];
  lb: TournamentMatch[][];
  gf: TournamentMatch[];
  matchesById: Record<string, TournamentMatch>;
  champion: string | null;
}

/**
 * Build a double-elimination bracket for `bots`. Winners rounds run for
 * `k = log2(size)` rounds; the losers bracket runs 2k-2 rounds; a double grand
 * final means the LB champion must beat the WB champion twice to take it.
 */
export function buildDoubleElimination(bots: string[], random: () => number = Math.random): Tournament {
  if (bots.length < 2) throw new Error('Double elimination needs at least 2 bots');

  const seeds = seedParticipants(bots, random);
  const size = seeds.length;
  const k = Math.round(Math.log2(size));
  const order = bracketSeedOrder(size);

  const matchesById: Record<string, TournamentMatch> = {};
  const make = (
    id: string,
    bracket: BracketKind,
    round: number,
    index: number,
    source: [SlotSource, SlotSource],
  ): TournamentMatch => {
    const m: TournamentMatch = {
      id,
      bracket,
      round,
      index,
      source,
      a: null,
      b: null,
      winner: null,
      loser: null,
      status: 'pending',
      nextWinner: null,
      nextLoser: null,
    };
    matchesById[id] = m;
    return m;
  };

  // Winners bracket.
  const wb: TournamentMatch[][] = [];
  for (let r = 0; r < k; r += 1) {
    const count = size / 2 ** (r + 1);
    const round: TournamentMatch[] = [];
    for (let i = 0; i < count; i += 1) {
      const source: [SlotSource, SlotSource] =
        r === 0
          ? [
              { kind: 'seed', index: order[2 * i] },
              { kind: 'seed', index: order[2 * i + 1] },
            ]
          : [
              { kind: 'winner', matchId: wb[r - 1][2 * i].id },
              { kind: 'winner', matchId: wb[r - 1][2 * i + 1].id },
            ];
      round.push(make(`W${r}-${i}`, 'WB', r, i, source));
    }
    wb.push(round);
  }

  // Losers bracket.
  const lb: TournamentMatch[][] = [];
  const lbRoundCount = Math.max(0, 2 * k - 2);
  for (let r = 1; r <= lbRoundCount; r += 1) {
    let count: number;
    if (r === 1) count = size / 4;
    else if (r % 2 === 1) count = lb[r - 2].length / 2;
    else count = size / 2 ** (r / 2 + 1);

    const round: TournamentMatch[] = [];
    for (let i = 0; i < count; i += 1) {
      let source: [SlotSource, SlotSource];
      if (r === 1) {
        source = [
          { kind: 'loser', matchId: wb[0][2 * i].id },
          { kind: 'loser', matchId: wb[0][2 * i + 1].id },
        ];
      } else if (r % 2 === 0) {
        source = [
          { kind: 'winner', matchId: lb[r - 2][i].id },
          { kind: 'loser', matchId: wb[r / 2][i].id },
        ];
      } else {
        source = [
          { kind: 'winner', matchId: lb[r - 2][2 * i].id },
          { kind: 'winner', matchId: lb[r - 2][2 * i + 1].id },
        ];
      }
      round.push(make(`L${r}-${i}`, 'LB', r - 1, i, source));
    }
    lb.push(round);
  }

  // Winners routing.
  for (let r = 0; r < k; r += 1) {
    for (let i = 0; i < wb[r].length; i += 1) {
      const m = wb[r][i];
      m.nextWinner =
        r < k - 1
          ? { matchId: wb[r + 1][Math.floor(i / 2)].id, slot: i % 2 === 0 ? 'a' : 'b' }
          : { matchId: 'GF0', slot: 'a' };
      if (r === 0) {
        m.nextLoser = k === 1 ? { matchId: 'GF0', slot: 'b' } : { matchId: lb[0][Math.floor(i / 2)].id, slot: i % 2 === 0 ? 'a' : 'b' };
      } else {
        m.nextLoser = { matchId: lb[2 * r - 1][i].id, slot: 'b' };
      }
    }
  }

  // Losers routing.
  for (let r = 1; r <= lbRoundCount; r += 1) {
    const round = lb[r - 1];
    for (let i = 0; i < round.length; i += 1) {
      round[i].nextWinner =
        r === lbRoundCount
          ? { matchId: 'GF0', slot: 'b' }
          : { matchId: lb[r][r % 2 === 1 ? i : Math.floor(i / 2)].id, slot: 'a' };
    }
  }

  // Grand final.
  const gfSlots: [SlotSource, SlotSource] =
    k === 1
      ? [
          { kind: 'winner', matchId: wb[0][0].id },
          { kind: 'loser', matchId: wb[0][0].id },
        ]
      : [
          { kind: 'winner', matchId: wb[k - 1][0].id },
          { kind: 'winner', matchId: lb[lbRoundCount - 1][0].id },
        ];
  const gf = [make('GF0', 'GF', 0, 0, gfSlots)];

  const tournament: Tournament = { size, seeds, wb, lb, gf, matchesById, champion: null };
  settleTournament(tournament);
  return tournament;
}

export function allMatches(t: Tournament): TournamentMatch[] {
  return [...t.wb.flat(), ...t.lb.flat(), ...t.gf];
}

function slotValue(t: Tournament, source: SlotSource): { known: boolean; player: string | null } {
  if (source.kind === 'seed') return { known: true, player: t.seeds[source.index] ?? null };
  const m = t.matchesById[source.matchId];
  if (!m || m.status === 'pending' || m.status === 'ready') return { known: false, player: null };
  return { known: true, player: source.kind === 'winner' ? m.winner : m.loser };
}

/**
 * Resolve every match whose inputs are known, marking byes and ready matches.
 * Idempotent — safe to call before each {@link nextReadyMatch}.
 */
export function settleTournament(t: Tournament): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of allMatches(t)) {
      if (m.status === 'done' || m.status === 'bye' || m.status === 'ready') continue;
      const a = slotValue(t, m.source[0]);
      const b = slotValue(t, m.source[1]);
      if (!a.known || !b.known) continue;

      m.a = a.player;
      m.b = b.player;
      if (a.player === null && b.player === null) {
        m.status = 'bye';
        m.winner = null;
        m.loser = null;
      } else if (a.player === null) {
        m.status = 'bye';
        m.winner = b.player;
        m.loser = null;
      } else if (b.player === null) {
        m.status = 'bye';
        m.winner = a.player;
        m.loser = null;
      } else {
        m.status = 'ready';
      }
      changed = true;
    }
  }
}

/** Return the next playable match (both players known, not yet decided). */
export function nextReadyMatch(t: Tournament): TournamentMatch | null {
  settleTournament(t);
  for (const m of allMatches(t)) {
    if (m.status === 'ready' && m.a !== null && m.b !== null) return m;
  }
  return null;
}

/** Record the winner of a ready match and advance the bracket. */
export function recordMatchResult(t: Tournament, match: TournamentMatch, winner: string): void {
  if (match.status !== 'ready') throw new Error(`Match ${match.id} is not ready`);
  if (winner !== match.a && winner !== match.b) {
    throw new Error(`Winner ${winner} is not in match ${match.id}`);
  }
  match.winner = winner;
  match.loser = winner === match.a ? match.b : match.a;
  match.status = 'done';

  if (match.bracket === 'GF') {
    if (t.gf.length === 1 && winner === match.b) {
      // LB champion drew first blood — force a bracket reset.
      t.gf.push(
        makeResetMatch(t, match),
      );
    } else {
      t.champion = winner;
    }
  }
  settleTournament(t);
}

function makeResetMatch(t: Tournament, firstGf: TournamentMatch): TournamentMatch {
  const reset: TournamentMatch = {
    id: 'GF-reset',
    bracket: 'GF',
    round: 1,
    index: 0,
    source: [
      { kind: 'winner', matchId: firstGf.id },
      { kind: 'loser', matchId: firstGf.id },
    ],
    a: null,
    b: null,
    winner: null,
    loser: null,
    status: 'pending',
    nextWinner: null,
    nextLoser: null,
  };
  t.matchesById[reset.id] = reset;
  return reset;
}

export function isTournamentFinished(t: Tournament): boolean {
  return t.champion !== null;
}

export function getChampion(t: Tournament): string | null {
  return t.champion;
}
