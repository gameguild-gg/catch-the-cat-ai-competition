import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/select';
import { HexagonalBoard } from '../components/HexagonalBoard';
import { Board, Position } from '../board';
import {
  ArenaMove,
  BOARD_SIZE,
  MOVE_DELAY_MS,
  runSingleMatch,
  WinnerInfo,
} from './match';
import {
  TournamentFormat,
  RoundRobinPairing,
  Standing,
  applyStandingResult,
  createStandings,
  roundRobinPairings,
  buildDoubleElimination,
  allMatches,
  nextReadyMatch,
  recordMatchResult,
  isTournamentFinished,
  getChampion,
  type TournamentMatch,
} from './tournament';

interface ArenaProps {}

type Mode = 'single' | 'tournament';

const DEFAULT_MOVE_LIMIT = 600;

function winnerName(outcome: WinnerInfo | null): string | null {
  return outcome ? outcome.username : null;
}

export function Arena({}: ArenaProps) {
  const [bots, setBots] = useState<string[] | null>(null);
  const [mode, setMode] = useState<Mode>('single');
  const [catBot, setCatBot] = useState('');
  const [catcherBot, setCatcherBot] = useState('');
  const [boardString, setBoardString] = useState(() => Board.generateRandomBoard(BOARD_SIZE));
  const [boardText, setBoardText] = useState('');
  const [boardError, setBoardError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [moves, setMoves] = useState<ArenaMove[]>([]);
  const [displayBoard, setDisplayBoard] = useState<string | null>(null);
  const [displayCat, setDisplayCat] = useState({ x: 0, y: 0 });
  const [winner, setWinner] = useState<WinnerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Tournament state
  const [selectedBots, setSelectedBots] = useState<string[]>([]);
  const [format, setFormat] = useState<TournamentFormat>('round-robin');
  const [moveLimit, setMoveLimit] = useState(DEFAULT_MOVE_LIMIT);
  const [tournamentRunning, setTournamentRunning] = useState(false);
  const [rrStandings, setRrStandings] = useState<Standing[]>([]);
  const [rrPairings, setRrPairings] = useState<RoundRobinPairing[]>([]);
  const [rrProgress, setRrProgress] = useState('');
  const [bracket, setBracket] = useState<TournamentMatch[]>([]);
  const [bracketChampion, setBracketChampion] = useState<string | null>(null);
  const [tournamentLog, setTournamentLog] = useState<string[]>([]);

  const stopRef = useRef(false);

  // Load manifest on mount
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}bots/manifest.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const names: string[] = (data.bots || []).map((b: { username: string }) => b.username);
        setBots(names);
        if (names.length >= 2) {
          setCatBot(names[0]);
          setCatcherBot(names[1]);
        } else if (names.length === 1) {
          setCatBot(names[0]);
          setCatcherBot(names[0]);
        }
        setSelectedBots(names);
      })
      .catch(() => setBots([]));
  }, []);

  const loadBoard = useCallback(() => {
    const text = boardText.trim();
    if (!/^[.#C]{441}$/.test(text) || (text.match(/C/g) || []).length !== 1) {
      setBoardError('Board must be 441 chars of [.#C] with exactly one C');
      return;
    }
    try {
      new Board(text, new Position(0, 0), 'cat', 'catcher');
      setBoardString(text);
      setBoardError(null);
    } catch (e) {
      setBoardError(e instanceof Error ? e.message : String(e));
    }
  }, [boardText]);

  const newRandomBoard = useCallback(() => {
    setBoardString(Board.generateRandomBoard(BOARD_SIZE));
    setBoardText('');
    setBoardError(null);
  }, []);

  const runMatch = useCallback(async () => {
    if (!catBot || !catcherBot || catBot === catcherBot) return;
    setRunning(true);
    setError(null);
    setWinner(null);
    setMoves([]);
    stopRef.current = false;

    const outcome = await runSingleMatch(catBot, catcherBot, boardString, {
      isStopped: () => stopRef.current,
      onProgress: (progress) => {
        setDisplayBoard(progress.board);
        setDisplayCat(progress.cat);
        setMoves(progress.moves);
      },
    });

    if (outcome.error) setError(outcome.error);
    if (!stopRef.current) setWinner(outcome.winner);

    setRunning(false);
  }, [catBot, catcherBot, boardString]);

  const toggleBot = useCallback((name: string) => {
    setSelectedBots((prev) => (prev.includes(name) ? prev.filter((b) => b !== name) : [...prev, name]));
  }, []);

  const stopTournament = useCallback(() => {
    stopRef.current = true;
  }, []);

  const runTournament = useCallback(async () => {
    const entrants = bots ? bots.filter((b) => selectedBots.includes(b)) : [];
    if (entrants.length < 2) return;
    setTournamentRunning(true);
    setError(null);
    setWinner(null);
    setMoves([]);
    setTournamentLog([]);
    setBracketChampion(null);
    stopRef.current = false;

    try {
      if (format === 'round-robin') {
        const pairings = roundRobinPairings(entrants);
        setRrPairings(pairings);
        let standings = createStandings(entrants);
        setRrStandings(standings);

        const limit = Math.min(pairings.length, moveLimit);
        for (let i = 0; i < limit; i += 1) {
          if (stopRef.current) break;
          const { cat, catcher } = pairings[i];
          setRrProgress(`${i} / ${limit} — ${cat} (cat) vs ${catcher} (catcher)`);
          setCatBot(cat);
          setCatcherBot(catcher);

          const outcome = await runSingleMatch(cat, catcher, boardString, {
            isStopped: () => stopRef.current,
            onProgress: (progress) => {
              setDisplayBoard(progress.board);
              setDisplayCat(progress.cat);
              setMoves(progress.moves);
            },
          });
          if (stopRef.current) break;

          const w = winnerName(outcome.winner);
          if (w) {
            const loser = w === cat ? catcher : cat;
            standings = applyStandingResult(standings, w, loser);
            setRrStandings(standings);
            setTournamentLog((log) => [...log, `${w} def. ${loser}`]);
          }
        }
        setRrProgress((p) =>
          stopRef.current
            ? `${p} (stopped)`
            : `${limit} / ${limit} — done`,
        );
      } else {
        const tournament = buildDoubleElimination(entrants);
        setBracket(allMatches(tournament));

        let guard = 0;
        while (!stopRef.current) {
          const match = nextReadyMatch(tournament);
          if (!match || match.a === null || match.b === null) break;
          if (guard++ > entrants.length * entrants.length * 4) break;

          setTournamentLog((log) => [
            ...log,
            `${match.bracket === 'GF' ? 'Grand final' : `[${match.bracket}${match.round + 1}]`} ${match.a} (cat) vs ${match.b} (catcher)`,
          ]);
          setCatBot(match.a);
          setCatcherBot(match.b);

          const outcome = await runSingleMatch(match.a, match.b, boardString, {
            isStopped: () => stopRef.current,
            onProgress: (progress) => {
              setDisplayBoard(progress.board);
              setDisplayCat(progress.cat);
              setMoves(progress.moves);
            },
          });
          if (stopRef.current) break;

          const w = winnerName(outcome.winner) ?? match.a;
          recordMatchResult(tournament, match, w);
          setBracket(allMatches(tournament));
        }

        if (!stopRef.current && isTournamentFinished(tournament)) {
          setBracketChampion(getChampion(tournament));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTournamentRunning(false);
    }
  }, [bots, selectedBots, format, boardString, moveLimit]);

  const boardForDisplay = displayBoard ?? boardString;

  // derive cat position from display board string (single C marker)
  const catPos = (() => {
    const idx = boardForDisplay.indexOf('C');
    const sideOver2 = Math.floor(BOARD_SIZE / 2);
    if (idx < 0) return { x: 0, y: 0 };
    return { x: (idx % BOARD_SIZE) - sideOver2, y: Math.floor(idx / BOARD_SIZE) - sideOver2 };
  })();

  if (bots === null) {
    return <div className="text-center p-8 text-muted-foreground">Loading bots…</div>;
  }

  if (bots.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-muted-foreground">No bots found. Run `npm run build:bots` first.</p>
        </CardContent>
      </Card>
    );
  }

  const bracketByKind = (kind: 'WB' | 'LB' | 'GF') => bracket.filter((m) => m.bracket === kind);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">⚔️ Arena</CardTitle>
          <CardDescription>
            Watch bots play catch the cat live, one match or a whole tournament
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 flex gap-2">
            <Button
              variant={mode === 'single' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('single')}
              disabled={running || tournamentRunning}
            >
              Single match
            </Button>
            <Button
              variant={mode === 'tournament' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('tournament')}
              disabled={running || tournamentRunning}
            >
              Tournament
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: board */}
            <div className="bg-muted rounded border overflow-x-auto">
              <HexagonalBoard boardString={boardForDisplay} catPosition={catPos} />
            </div>

            {/* Right: controls + moves */}
            <div className="space-y-4">
              {mode === 'single' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Cat bot</label>
                      <Select value={catBot} onChange={(e) => setCatBot(e.target.value)} disabled={running}>
                        {bots.map((b) => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Catcher bot</label>
                      <Select value={catcherBot} onChange={(e) => setCatcherBot(e.target.value)} disabled={running}>
                        {bots.map((b) => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </Select>
                    </div>
                  </div>

                  {catBot === catcherBot && (
                    <p className="text-sm text-destructive">Pick two distinct bots to run a match.</p>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Button onClick={newRandomBoard} variant="outline" size="sm" disabled={running}>
                        New random board
                      </Button>
                      <Button
                        onClick={runMatch}
                        size="sm"
                        disabled={running || catBot === catcherBot}
                      >
                        {running ? 'Running…' : 'Run match'}
                      </Button>
                    </div>
                    <textarea
                      className="w-full h-20 p-2 text-xs font-mono rounded border bg-background"
                      placeholder="Paste a 441-char board ([.#C], exactly one C) to load"
                      value={boardText}
                      onChange={(e) => setBoardText(e.target.value)}
                      disabled={running}
                    />
                    <div className="flex items-center gap-2">
                      <Button onClick={loadBoard} variant="outline" size="sm" disabled={running}>
                        Load board
                      </Button>
                      {boardError && <span className="text-xs text-destructive">{boardError}</span>}
                    </div>
                  </div>

                  {winner && (
                    <div className="rounded border p-3 text-sm">
                      🏆 <span className="font-medium">{winner.username}</span> wins as {winner.side}
                    </div>
                  )}
                  {error && <p className="text-sm text-destructive">{error}</p>}
                </>
              )}

              {mode === 'tournament' && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Entrants ({selectedBots.length}/{bots.length})
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {bots.map((b) => (
                        <label
                          key={b}
                          className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${
                            selectedBots.includes(b) ? 'bg-primary/10 border-primary' : ''
                          } ${tournamentRunning ? 'opacity-60' : 'cursor-pointer'}`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedBots.includes(b)}
                            onChange={() => toggleBot(b)}
                            disabled={tournamentRunning}
                          />
                          {b}
                        </label>
                      ))}
                    </div>
                    <div className="flex gap-2 text-xs">
                      <button
                        className="underline"
                        onClick={() => setSelectedBots(bots)}
                        disabled={tournamentRunning}
                      >
                        Select all
                      </button>
                      <button className="underline" onClick={() => setSelectedBots([])} disabled={tournamentRunning}>
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Format</label>
                      <Select
                        value={format}
                        onChange={(e) => setFormat(e.target.value as TournamentFormat)}
                        disabled={tournamentRunning}
                      >
                        <option value="round-robin">Round robin</option>
                        <option value="double-elimination">Double elimination</option>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Max matches</label>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        className="w-full p-2 text-sm rounded border bg-background"
                        value={moveLimit}
                        onChange={(e) => setMoveLimit(Math.max(1, Number(e.target.value) || 1))}
                        disabled={tournamentRunning}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      onClick={runTournament}
                      size="sm"
                      disabled={tournamentRunning || selectedBots.length < 2}
                    >
                      {tournamentRunning ? 'Running…' : 'Run tournament'}
                    </Button>
                    {tournamentRunning && (
                      <Button onClick={stopTournament} variant="outline" size="sm">
                        Stop
                      </Button>
                    )}
                    {selectedBots.length < 2 && (
                      <span className="text-xs text-muted-foreground">Select at least 2 bots.</span>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Button onClick={newRandomBoard} variant="outline" size="sm" disabled={tournamentRunning}>
                      New random board
                    </Button>
                  </div>

                  {winner && (
                    <div className="rounded border p-3 text-sm">
                      🏆 <span className="font-medium">{winner.username}</span> wins as {winner.side}
                    </div>
                  )}
                  {error && <p className="text-sm text-destructive">{error}</p>}
                </>
              )}

              {moves.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium">Moves ({moves.length})</p>
                  <div className="max-h-40 overflow-y-auto rounded border text-xs">
                    {moves
                      .slice()
                      .reverse()
                      .map((m) => (
                        <div key={m.n} className="flex justify-between border-b px-2 py-1 last:border-b-0">
                          <span>
                            {m.n}. {m.username} ({m.turn})
                          </span>
                          <span className="font-mono">
                            ({m.move.x},{m.move.y})
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {mode === 'tournament' && format === 'round-robin' && rrStandings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Round robin standings</CardTitle>
            {rrProgress && <CardDescription>{rrProgress}</CardDescription>}
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">#</th>
                  <th>Bot</th>
                  <th>W</th>
                  <th>L</th>
                  <th>Pts</th>
                </tr>
              </thead>
              <tbody>
                {rrStandings.map((s, i) => (
                  <tr key={s.bot} className="border-t">
                    <td className="py-1">{i + 1}</td>
                    <td>{s.bot}</td>
                    <td>{s.wins}</td>
                    <td>{s.losses}</td>
                    <td>{s.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rrPairings.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">{rrPairings.length} scheduled matches</p>
            )}
          </CardContent>
        </Card>
      )}

      {mode === 'tournament' && format === 'double-elimination' && bracket.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Double-elimination bracket</CardTitle>
            {bracketChampion && (
              <CardDescription>🏆 Champion: {bracketChampion}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {(['WB', 'LB', 'GF'] as const).map((kind) => {
              const matches = bracketByKind(kind);
              if (matches.length === 0) return null;
              const title = kind === 'WB' ? 'Winners' : kind === 'LB' ? 'Losers' : 'Grand final';
              return (
                <div key={kind}>
                  <p className="mb-1 text-sm font-medium">{title}</p>
                  <div className="flex flex-wrap gap-2">
                    {matches.map((m) => (
                      <div
                        key={m.id}
                        className={`rounded border px-2 py-1 text-xs ${m.status === 'done' ? 'bg-muted' : ''}`}
                        title={m.id}
                      >
                        <div className={m.winner === m.a && m.a ? 'font-medium' : ''}>
                          {m.a ?? '—'}: {m.winner === m.a && m.a ? 'W' : ''}
                        </div>
                        <div className={m.winner === m.b && m.b ? 'font-medium' : ''}>
                          {m.b ?? '—'}: {m.winner === m.b && m.b ? 'W' : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {mode === 'tournament' && tournamentLog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Match log</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-60 space-y-1 overflow-y-auto text-xs font-mono">
              {tournamentLog.map((entry, i) => (
                <div key={i}>{entry}</div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
