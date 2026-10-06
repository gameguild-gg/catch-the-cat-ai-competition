import { describe, it, expect } from 'vitest';
import {
  nextPowerOfTwo,
  roundRobinPairings,
  createStandings,
  applyStandingResult,
  buildDoubleElimination,
  nextReadyMatch,
  recordMatchResult,
  settleTournament,
  allMatches,
  isTournamentFinished,
  getChampion,
  type Tournament,
} from './tournament';

const BOTS = ['a', 'b', 'c', 'd', 'e'];

/** Deterministic RNG so seeding is stable across runs. */
const seededRng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

function allPairs(bots: string[]): string[] {
  const pairs: string[] = [];
  for (let i = 0; i < bots.length; i += 1) {
    for (let j = i + 1; j < bots.length; j += 1) {
      pairs.push([bots[i], bots[j]].sort().join('-'));
    }
  }
  return pairs.sort();
}

describe('roundRobinPairings', () => {
  it('covers every unordered pair exactly once', () => {
    const pairings = roundRobinPairings(BOTS);
    expect(pairings.length).toBe((BOTS.length * (BOTS.length - 1)) / 2);
    const seen = pairings.map((p) => [p.cat, p.catcher].sort().join('-')).sort();
    expect(seen).toEqual(allPairs(BOTS));
  });

  it('produces no self-pairings', () => {
    expect(roundRobinPairings(BOTS).every((p) => p.cat !== p.catcher)).toBe(true);
  });

  it('is empty for fewer than 2 bots', () => {
    expect(roundRobinPairings(['solo'])).toEqual([]);
    expect(roundRobinPairings([])).toEqual([]);
  });
});

describe('standings', () => {
  it('awards 3 points for a win and 0 for a loss, sorted by wins', () => {
    let s = createStandings(['a', 'b', 'c']);
    s = applyStandingResult(s, 'a', 'b');
    s = applyStandingResult(s, 'a', 'c');
    s = applyStandingResult(s, 'b', 'c');
    expect(s[0]).toMatchObject({ bot: 'a', wins: 2, losses: 0, points: 6 });
    expect(s[1]).toMatchObject({ bot: 'b', wins: 1, losses: 1, points: 3 });
    expect(s[2]).toMatchObject({ bot: 'c', wins: 0, losses: 2, points: 0 });
  });
});

describe('nextPowerOfTwo', () => {
  it('rounds up, with a floor of 2', () => {
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(5)).toBe(8);
    expect(nextPowerOfTwo(8)).toBe(8);
    expect(nextPowerOfTwo(1)).toBe(2);
    expect(nextPowerOfTwo(0)).toBe(2);
  });
});

describe('buildDoubleElimination', () => {
  it('pads to a power of two', () => {
    expect(buildDoubleElimination(BOTS, seededRng(1)).size).toBe(8);
    expect(buildDoubleElimination(['a', 'b', 'c'], seededRng(1)).size).toBe(4);
  });

  it('gives a bye in round 0 when the field is not a power of two', () => {
    const t = buildDoubleElimination(BOTS, seededRng(1)); // 8-slot bracket, 3 byes
    const byes = t.wb[0].filter((m) => m.status === 'bye');
    expect(byes.length).toBe(3);
    for (const m of byes) {
      expect(m.b).toBeNull();
      expect(m.winner).toBe(m.a);
    }
  });

  it('sizes the losers bracket as 2k-2 rounds', () => {
    const t = buildDoubleElimination(BOTS, seededRng(2)); // k = 3
    expect(t.wb.length).toBe(3);
    expect(t.lb.length).toBe(4);
    expect(t.gf.length).toBe(1);
  });

  it('never places two byes against each other', () => {
    const t = buildDoubleElimination(BOTS, seededRng(3));
    for (const m of t.wb[0]) {
      expect(m.a).not.toBeNull();
    }
  });
});

/** Drive a tournament to completion by always letting `a` win; returns played count. */
function playToEnd(t: Tournament, pick: (a: string, b: string) => string): number {
  let played = 0;
  let guard = 0;
  while (!isTournamentFinished(t)) {
    if (guard++ > 200) throw new Error('tournament did not terminate');
    const m = nextReadyMatch(t);
    if (!m) throw new Error(`stuck: no ready match, finished=${isTournamentFinished(t)}`);
    recordMatchResult(t, m, pick(m.a as string, m.b as string));
    played += 1;
  }
  return played;
}

describe('double-elimination flow', () => {
  it('terminates with a single champion when the WB winner wins the final', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const t = buildDoubleElimination(BOTS, seededRng(seed));
      const played = playToEnd(t, (a) => a); // favourite always wins
      const champion = getChampion(t);
      expect(champion).not.toBeNull();
      expect(t.gf.length).toBe(1);
      // n-1 WB + n-2 LB + 1 GF = 2n-2
      expect(played).toBe(2 * BOTS.length - 2);
    }
  });

  it('forces a bracket reset when the LB champion wins the first grand final', () => {
    const t = buildDoubleElimination(BOTS, seededRng(7));
    // Play everything, but in the very first grand final let the LB side win.
    let guard = 0;
    while (!isTournamentFinished(t)) {
      if (guard++ > 200) throw new Error('tournament did not terminate');
      const m = nextReadyMatch(t);
      if (!m) throw new Error('stuck');
      if (m.bracket === 'GF' && t.gf.length === 1) {
        expect(m.b).not.toBeNull();
        recordMatchResult(t, m, m.b as string);
        expect(t.gf.length).toBe(2);
      } else {
        recordMatchResult(t, m, m.a as string);
      }
    }
    expect(t.gf.length).toBe(2);
    expect(getChampion(t)).not.toBeNull();
  });

  it('records a loser for every completed elimination match', () => {
    const t = buildDoubleElimination(BOTS, seededRng(11));
    playToEnd(t, (a) => a);
    for (const m of allMatches(t)) {
      if (m.status === 'done' && m.bracket !== 'GF') {
        expect(m.winner).not.toBeNull();
        expect(m.loser).not.toBeNull();
        expect(m.loser).not.toBe(m.winner);
      }
    }
  });

  it('handles a two-bot field', () => {
    const t = buildDoubleElimination(['a', 'b'], seededRng(1));
    expect(t.wb.length).toBe(1);
    expect(t.lb.length).toBe(0);
    playToEnd(t, (a) => a);
    expect(getChampion(t)).toBe('a');
  });

  it('rejects fields smaller than 2', () => {
    expect(() => buildDoubleElimination(['solo'], seededRng(1))).toThrow();
  });

  it('settleTournament is idempotent', () => {
    const t = buildDoubleElimination(BOTS, seededRng(5));
    settleTournament(t);
    const before = allMatches(t).map((m) => m.status).join(',');
    settleTournament(t);
    expect(allMatches(t).map((m) => m.status).join(',')).toBe(before);
  });
});
