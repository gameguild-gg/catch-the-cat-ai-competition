import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  defaultWorkerPool,
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

const CURRENT_SEASON_BOTS = new Set(['ColinSkaarup', 'AaronArchambault', 'lukehinojosa']);
const DEFAULT_MOVE_LIMIT = 600;
const MAX_LOG_ENTRIES = 200;

type Mode = 'single' | 'tournament';
type SpeedMode = 'fast' | 'normal';
type BracketTab = 'all' | 'WB' | 'LB' | 'GF';

function winnerName(outcome: WinnerInfo | null): string | null {
  return outcome ? outcome.username : null;
}

export function Arena() {
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
  const [speedMode, setSpeedMode] = useState<SpeedMode>('fast');
  const [tournamentRunning, setTournamentRunning] = useState(false);
  const [rrStandings, setRrStandings] = useState<Standing[]>([]);
  const [rrPairings, setRrPairings] = useState<RoundRobinPairing[]>([]);
  const [rrProgress, setRrProgress] = useState('');
  const [bracket, setBracket] = useState<TournamentMatch[]>([]);
  const [bracketChampion, setBracketChampion] = useState<string | null>(null);
  const [tournamentLog, setTournamentLog] = useState<string[]>([]);
  const [progressPercent, setProgressPercent] = useState<number>(0);

  // Entrant UI state
  const [searchTerm, setSearchTerm] = useState('');
  const [entrantFilter, setEntrantFilter] = useState<'all' | 'current' | 'selected'>('all');
  const [bracketTab, setBracketTab] = useState<BracketTab>('all');

  const isFirefox = useMemo(() => typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent), []);

  const stopRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

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

  // Auto-scroll match log to bottom
  useEffect(() => {
    if (tournamentLog.length > 0 && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [tournamentLog.length]);

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
    console.log(`[Arena] Initiating single match: ${catBot} (cat) vs ${catcherBot} (catcher)`);
    setRunning(true);
    setError(null);
    setWinner(null);
    setMoves([]);
    stopRef.current = false;

    const outcome = await runSingleMatch(catBot, catcherBot, boardString, {
      isStopped: () => stopRef.current,
      moveDelayMs: 200,
      onProgress: (progress) => {
        setDisplayBoard(progress.board);
        setDisplayCat(progress.cat);
        setMoves(progress.moves);
      },
    });

    if (outcome.error) {
      console.error(`[Arena] Single match error (${catBot} vs ${catcherBot}):`, outcome.error);
      setError(outcome.error);
    }
    if (!stopRef.current) {
      console.log(`[Arena] Single match result:`, outcome.winner);
      setWinner(outcome.winner);
    }

    setRunning(false);
  }, [catBot, catcherBot, boardString]);

  const toggleBot = useCallback((name: string) => {
    setSelectedBots((prev) => (prev.includes(name) ? prev.filter((b) => b !== name) : [...prev, name]));
  }, []);

  const selectCurrentSeasonOnly = useCallback(() => {
    if (!bots) return;
    const currentList = bots.filter((b) => CURRENT_SEASON_BOTS.has(b));
    setSelectedBots(currentList);
  }, [bots]);

  const selectAllBots = useCallback(() => {
    if (!bots) return;
    setSelectedBots([...bots]);
  }, [bots]);

  const clearBotSelection = useCallback(() => {
    setSelectedBots([]);
  }, []);

  const stopTournament = useCallback(() => {
    stopRef.current = true;
  }, []);

  const appendLog = useCallback((msg: string) => {
    setTournamentLog((prev) => {
      const next = [...prev, msg];
      return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next;
    });
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
    setProgressPercent(0);
    stopRef.current = false;

    const delayMs = speedMode === 'fast' ? 0 : 100;
    const tournamentWorkers = defaultWorkerPool.getWorkers();

    console.log(`[Arena] Starting ${format} tournament with ${entrants.length} entrants (speed=${speedMode})`);
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
          setRrProgress(`${i + 1} / ${limit} — ${cat} (cat) vs ${catcher} (catcher)`);
          setProgressPercent(Math.round(((i + 1) / limit) * 100));
          setCatBot(cat);
          setCatcherBot(catcher);

          const outcome = await runSingleMatch(cat, catcher, boardString, {
            isStopped: () => stopRef.current,
            moveDelayMs: delayMs,
            workers: tournamentWorkers,
            onProgress: (progress) => {
              if (speedMode === 'normal') {
                setDisplayBoard(progress.board);
                setDisplayCat(progress.cat);
                setMoves(progress.moves);
              }
            },
          });
          if (stopRef.current) break;

          const w = winnerName(outcome.winner);
          if (w) {
            const loser = w === cat ? catcher : cat;
            standings = applyStandingResult(standings, w, loser);
            setRrStandings(standings);
            appendLog(`[RR #${i + 1}] 🏆 ${w} def. ${loser}`);
          }
        }
        setRrProgress((p) => (stopRef.current ? `${p} (stopped)` : `${limit} / ${limit} — Complete`));
        setProgressPercent(100);
      } else {
        const tournament = buildDoubleElimination(entrants);
        const matchesList = allMatches(tournament);
        setBracket(matchesList);

        const totalEstimatedMatches = matchesList.length;
        let completedCount = 0;
        let guard = 0;

        while (!stopRef.current) {
          const match = nextReadyMatch(tournament);
          if (!match || match.a === null || match.b === null) break;
          if (guard++ > entrants.length * entrants.length * 4) break;

          const botA = match.a;
          const botB = match.b;
          const matchLabel = match.bracket === 'GF' ? 'Grand Final' : `[${match.bracket} R${match.round + 1}]`;

          appendLog(`${matchLabel} ⚔️ ${botA} vs ${botB} (2-Game Series)`);

          // --- Game 1: botA (Cat) vs botB (Catcher) ---
          setCatBot(botA);
          setCatcherBot(botB);
          const outcome1 = await runSingleMatch(botA, botB, boardString, {
            isStopped: () => stopRef.current,
            moveDelayMs: delayMs,
            workers: tournamentWorkers,
            onProgress: (progress) => {
              if (speedMode === 'normal') {
                setDisplayBoard(progress.board);
                setDisplayCat(progress.cat);
                setMoves(progress.moves);
              }
            },
          });
          if (stopRef.current) break;

          const leg1Winner = winnerName(outcome1.winner) ?? botA;
          const moves1 = Math.max(1, outcome1.moves.length);
          const maxMoves = BOARD_SIZE * BOARD_SIZE;

          const pts1_A = leg1Winner === botA ? maxMoves - moves1 : moves1;
          const pts1_B = leg1Winner === botB ? maxMoves - moves1 : moves1;

          appendLog(`  ↳ Game 1: ${botA} (Cat) vs ${botB} (Catcher) → Winner: ${leg1Winner} (${moves1} moves | Pts: ${pts1_A} vs ${pts1_B})`);

          // --- Game 2: SWAP ROLES — botB (Cat) vs botA (Catcher) ---
          setCatBot(botB);
          setCatcherBot(botA);
          const outcome2 = await runSingleMatch(botB, botA, boardString, {
            isStopped: () => stopRef.current,
            moveDelayMs: delayMs,
            workers: tournamentWorkers,
            onProgress: (progress) => {
              if (speedMode === 'normal') {
                setDisplayBoard(progress.board);
                setDisplayCat(progress.cat);
                setMoves(progress.moves);
              }
            },
          });
          if (stopRef.current) break;

          const leg2Winner = winnerName(outcome2.winner) ?? botB;
          const moves2 = Math.max(1, outcome2.moves.length);

          const pts2_B = leg2Winner === botB ? maxMoves - moves2 : moves2;
          const pts2_A = leg2Winner === botA ? maxMoves - moves2 : moves2;

          appendLog(`  ↳ Game 2: ${botB} (Cat) vs ${botA} (Catcher) → Winner: ${leg2Winner} (${moves2} moves | Pts: ${pts2_B} vs ${pts2_A})`);

          // --- Series Scoring & Tie-Breaker ---
          const winsA = (leg1Winner === botA ? 1 : 0) + (leg2Winner === botA ? 1 : 0);
          const winsB = (leg1Winner === botB ? 1 : 0) + (leg2Winner === botB ? 1 : 0);
          const totalPtsA = pts1_A + pts2_A;
          const totalPtsB = pts1_B + pts2_B;

          let seriesWinner: string;
          let scoreSummary: string;

          if (winsA === 2) {
            seriesWinner = botA;
            scoreSummary = `2-0`;
          } else if (winsB === 2) {
            seriesWinner = botB;
            scoreSummary = `0-2`;
          } else {
            // 1-1 Draw in game wins — Tiebreaker: higher total points across 2 games
            if (totalPtsA > totalPtsB) {
              seriesWinner = botA;
              scoreSummary = `1-1 (${totalPtsA} > ${totalPtsB} pts)`;
            } else if (totalPtsB > totalPtsA) {
              seriesWinner = botB;
              scoreSummary = `1-1 (${totalPtsB} > ${totalPtsA} pts)`;
            } else {
              seriesWinner = botA;
              scoreSummary = `1-1 (${totalPtsA} pts tie)`;
            }
          }

          const seriesLoser = seriesWinner === botA ? botB : botA;
          match.scoreSummary = scoreSummary;

          recordMatchResult(tournament, match, seriesWinner);
          setBracket(allMatches(tournament));
          completedCount++;
          setProgressPercent(Math.min(100, Math.round((completedCount / Math.max(1, totalEstimatedMatches)) * 100)));
          appendLog(`  🏆 Series Result: ${seriesWinner} def. ${seriesLoser} [${scoreSummary}]`);
        }

        if (!stopRef.current && isTournamentFinished(tournament)) {
          const champ = getChampion(tournament);
          setBracketChampion(champ);
          if (champ) appendLog(`🏆 TOURNAMENT CHAMPION: ${champ}!`);
        }
        setProgressPercent(100);
      }
    } catch (e) {
      console.error('[Arena] Tournament execution error:', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      console.log('[Arena] Tournament finished/stopped');
      defaultWorkerPool.reset();
      setTournamentRunning(false);
    }
  }, [bots, selectedBots, format, boardString, moveLimit, speedMode, appendLog]);

  const boardForDisplay = displayBoard ?? boardString;

  // derive cat position from display board string (single C marker)
  const catPos = useMemo(() => {
    const idx = boardForDisplay.indexOf('C');
    const sideOver2 = Math.floor(BOARD_SIZE / 2);
    if (idx < 0) return { x: 0, y: 0 };
    return { x: (idx % BOARD_SIZE) - sideOver2, y: Math.floor(idx / BOARD_SIZE) - sideOver2 };
  }, [boardForDisplay]);

  // Filtered bot list for Entrant Selection
  const filteredBots = useMemo(() => {
    if (!bots) return [];
    return bots.filter((b) => {
      const isCurrentSeason = CURRENT_SEASON_BOTS.has(b);
      const isSelected = selectedBots.includes(b);

      if (entrantFilter === 'current' && !isCurrentSeason) return false;
      if (entrantFilter === 'selected' && !isSelected) return false;

      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        return b.toLowerCase().includes(query) || (isCurrentSeason && 'current season 2026'.includes(query));
      }
      return true;
    });
  }, [bots, selectedBots, searchTerm, entrantFilter]);

  const currentSeasonSelectedCount = useMemo(() => {
    return selectedBots.filter((b) => CURRENT_SEASON_BOTS.has(b)).length;
  }, [selectedBots]);

  if (bots === null) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-muted-foreground space-y-3">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-medium">Loading bot binaries manifest…</p>
      </div>
    );
  }

  if (bots.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-3">
          <div className="text-4xl">🤖</div>
          <CardTitle>No Bots Found</CardTitle>
          <CardDescription>
            No compiled bot binaries found in <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">public/bots</code>.
          </CardDescription>
          <p className="text-xs text-muted-foreground">Run <code className="font-mono text-primary">npm run build:bots</code> to build bot binaries from student forks.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="border-primary/20 shadow-sm bg-gradient-to-r from-card via-card to-primary/5">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-2xl font-bold tracking-tight">⚔️ Catch-The-Cat Arena</CardTitle>
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-xs">
                  {bots.length} Entrants Available
                </Badge>
              </div>
              <CardDescription className="mt-1">
                Watch AI bots compete live head-to-head or simulate complete tournament brackets.
              </CardDescription>
            </div>

            {/* Mode Switcher */}
            <div className="flex items-center gap-1 bg-muted p-1 rounded-lg self-start sm:self-auto border">
              <Button
                variant={mode === 'single' ? 'default' : 'ghost'}
                size="sm"
                className="text-xs px-3 h-8 font-medium"
                onClick={() => setMode('single')}
                disabled={running || tournamentRunning}
              >
                🎮 Single Match
              </Button>
              <Button
                variant={mode === 'tournament' ? 'default' : 'ghost'}
                size="sm"
                className="text-xs px-3 h-8 font-medium"
                onClick={() => setMode('tournament')}
                disabled={running || tournamentRunning}
              >
                🏆 Tournament
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Main Arena Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 5 cols: Board */}
        <div className="lg:col-span-5 space-y-4">
          <Card className="overflow-hidden">
            <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <span>🎯 Match Board</span>
                <span className="text-xs font-normal text-muted-foreground">(21x21 Hex)</span>
              </CardTitle>
              {running && (
                <Badge variant="secondary" className="animate-pulse bg-emerald-500/20 text-emerald-600 text-xs">
                  Live Match
                </Badge>
              )}
            </CardHeader>
            <CardContent className="p-3 flex justify-center bg-slate-900/5 dark:bg-slate-900/40">
              <div className="w-full max-w-[420px]">
                <HexagonalBoard boardString={boardForDisplay} catPosition={catPos} />
              </div>
            </CardContent>
          </Card>

          {/* Moves History (Single Match or Live Mode) */}
          {moves.length > 0 && (
            <Card>
              <CardHeader className="py-2.5 px-4 bg-muted/30 border-b flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Move History ({moves.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-48 overflow-y-auto divide-y text-xs font-mono">
                  {moves
                    .slice()
                    .reverse()
                    .map((m) => (
                      <div key={m.n} className="flex items-center justify-between px-3 py-1.5 hover:bg-muted/40 transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground w-6 font-bold">{m.n}.</span>
                          <span className={m.turn === 'cat' ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-blue-600 dark:text-blue-400 font-medium'}>
                            {m.username}
                          </span>
                          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                            {m.turn}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-foreground">({m.move.x}, {m.move.y})</span>
                          {m.timeUs !== undefined && (
                            <span className="text-[10px] text-muted-foreground">{(m.timeUs / 1000).toFixed(1)}ms</span>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right 7 cols: Controls & Settings */}
        <div className="lg:col-span-7 space-y-4">
          {mode === 'single' ? (
            /* Single Match Controls */
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Single Match Setup</CardTitle>
                <CardDescription>Select two bots to fight on the hexagonal board.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold flex items-center justify-between">
                      <span>🐱 Cat Bot</span>
                      {CURRENT_SEASON_BOTS.has(catBot) && (
                        <span className="text-[10px] text-amber-500 font-bold">⭐ 2026 Season</span>
                      )}
                    </label>
                    <Select value={catBot} onChange={(e) => setCatBot(e.target.value)} disabled={running}>
                      {bots.map((b) => (
                        <option key={b} value={b}>
                          {CURRENT_SEASON_BOTS.has(b) ? `⭐ ${b}` : b}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold flex items-center justify-between">
                      <span>🛡️ Catcher Bot</span>
                      {CURRENT_SEASON_BOTS.has(catcherBot) && (
                        <span className="text-[10px] text-amber-500 font-bold">⭐ 2026 Season</span>
                      )}
                    </label>
                    <Select value={catcherBot} onChange={(e) => setCatcherBot(e.target.value)} disabled={running}>
                      {bots.map((b) => (
                        <option key={b} value={b}>
                          {CURRENT_SEASON_BOTS.has(b) ? `⭐ ${b}` : b}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      const temp = catBot;
                      setCatBot(catcherBot);
                      setCatcherBot(temp);
                    }}
                    disabled={running}
                  >
                    ⇄ Swap Roles
                  </Button>

                  <Button onClick={newRandomBoard} variant="outline" size="sm" className="text-xs" disabled={running}>
                    🎲 New Random Board
                  </Button>

                  <Button
                    onClick={runMatch}
                    size="sm"
                    className="text-xs font-semibold bg-primary text-primary-foreground ml-auto"
                    disabled={running || catBot === catcherBot}
                  >
                    {running ? '🎮 Running Match…' : '▶ Start Match'}
                  </Button>
                </div>

                {catBot === catcherBot && (
                  <p className="text-xs text-destructive bg-destructive/10 p-2 rounded border border-destructive/20">
                    ⚠️ Please select two distinct bots to run a match.
                  </p>
                )}

                {/* Custom Board Loader */}
                <div className="space-y-2 pt-2 border-t">
                  <label className="text-xs font-medium text-muted-foreground">Custom Board Loader (441 chars)</label>
                  <textarea
                    className="w-full h-16 p-2 text-[11px] font-mono rounded border bg-background focus:ring-1 focus:ring-primary"
                    placeholder="Paste board string formatted with [.#C], exactly one C..."
                    value={boardText}
                    onChange={(e) => setBoardText(e.target.value)}
                    disabled={running}
                  />
                  <div className="flex items-center gap-2">
                    <Button onClick={loadBoard} variant="outline" size="sm" className="text-xs" disabled={running}>
                      Load Custom Board
                    </Button>
                    {boardError && <span className="text-xs text-destructive font-medium">{boardError}</span>}
                  </div>
                </div>

                {winner && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm flex items-center gap-2">
                    <span className="text-xl">🏆</span>
                    <div>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">{winner.username}</span> won the match playing as <span className="font-semibold uppercase">{winner.side}</span>!
                    </div>
                  </div>
                )}
                {error && <p className="text-xs text-destructive bg-destructive/10 p-2.5 rounded border">{error}</p>}
              </CardContent>
            </Card>
          ) : (
            /* Tournament Controls & Entrant Selector */
            <Card className="space-y-0">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Tournament Setup</CardTitle>
                    <CardDescription>Configure entrants, format, and simulation speed.</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      Selected: <strong className="ml-1 text-primary">{selectedBots.length}</strong> / {bots.length}
                    </Badge>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Firefox Performance Notice - shown only when NOT running on Firefox */}
                {!isFirefox && (
                  <div className="flex items-center gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
                    <span className="text-base shrink-0">🦊</span>
                    <div>
                      <strong className="font-semibold">Performance Tip:</strong> Tournament simulations run faster and more reliably on <strong className="font-semibold underline">Mozilla Firefox</strong> due to its optimized WebAssembly memory engine.
                    </div>
                  </div>
                )}

                {/* Entrants Selector Panel */}
                <div className="space-y-2 rounded-lg border p-3 bg-muted/20">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Button
                        variant="default"
                        size="sm"
                        className="text-[11px] h-7 px-2.5 bg-amber-600 hover:bg-amber-700 text-white font-medium"
                        onClick={selectCurrentSeasonOnly}
                        disabled={tournamentRunning}
                      >
                        ⭐ Select 2026 Season ({CURRENT_SEASON_BOTS.size})
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-[11px] h-7 px-2"
                        onClick={selectAllBots}
                        disabled={tournamentRunning}
                      >
                        Select All ({bots.length})
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-[11px] h-7 px-2 text-muted-foreground"
                        onClick={clearBotSelection}
                        disabled={tournamentRunning}
                      >
                        Clear
                      </Button>
                    </div>

                    {/* Filter Tabs */}
                    <div className="flex items-center gap-1 bg-background p-0.5 rounded border text-[11px]">
                      <button
                        className={`px-2 py-0.5 rounded ${entrantFilter === 'all' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground'}`}
                        onClick={() => setEntrantFilter('all')}
                      >
                        All
                      </button>
                      <button
                        className={`px-2 py-0.5 rounded ${entrantFilter === 'current' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground'}`}
                        onClick={() => setEntrantFilter('current')}
                      >
                        2026 Season ({CURRENT_SEASON_BOTS.size})
                      </button>
                      <button
                        className={`px-2 py-0.5 rounded ${entrantFilter === 'selected' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground'}`}
                        onClick={() => setEntrantFilter('selected')}
                      >
                        Selected ({selectedBots.length})
                      </button>
                    </div>
                  </div>

                  {/* Search bar */}
                  <div className="relative">
                    <input
                      type="text"
                      className="w-full h-8 pl-8 pr-3 text-xs rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="Search entrant by name..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      disabled={tournamentRunning}
                    />
                    <span className="absolute left-2.5 top-2 text-xs text-muted-foreground">🔍</span>
                    {searchTerm && (
                      <button
                        className="absolute right-2 top-1.5 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setSearchTerm('')}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Scrollable Entrant Grid */}
                  <div className="max-h-48 overflow-y-auto pr-1">
                    {filteredBots.length === 0 ? (
                      <div className="p-4 text-center text-xs text-muted-foreground">
                        No entrants matching "{searchTerm}"
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        {filteredBots.map((b) => {
                          const isSelected = selectedBots.includes(b);
                          const isCurrent = CURRENT_SEASON_BOTS.has(b);
                          return (
                            <button
                              type="button"
                              key={b}
                              onClick={() => !tournamentRunning && toggleBot(b)}
                              disabled={tournamentRunning}
                              className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded text-left text-xs transition-all border ${
                                isSelected
                                  ? 'bg-primary/10 border-primary font-medium text-foreground shadow-xs'
                                  : 'bg-background hover:bg-muted border-border/60 text-muted-foreground'
                              } ${tournamentRunning ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[10px] ${
                                  isSelected ? 'bg-primary text-primary-foreground border-primary' : 'border-muted-foreground/40'
                                }`}>
                                  {isSelected ? '✓' : ''}
                                </span>
                                <span className="truncate">{b}</span>
                              </div>
                              {isCurrent && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 shrink-0 font-semibold">
                                  2026
                                </Badge>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Tournament Parameters */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold">Tournament Format</label>
                    <Select
                      value={format}
                      onChange={(e) => setFormat(e.target.value as TournamentFormat)}
                      disabled={tournamentRunning}
                    >
                      <option value="round-robin">Round Robin</option>
                      <option value="double-elimination">Double Elimination</option>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold">Simulation Speed</label>
                    <Select
                      value={speedMode}
                      onChange={(e) => setSpeedMode(e.target.value as SpeedMode)}
                      disabled={tournamentRunning}
                    >
                      <option value="fast">⚡ Fast (Headless)</option>
                      <option value="normal">👁️ Normal (Live Moves)</option>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold">Max Matches</label>
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      className="w-full p-1.5 text-xs rounded border bg-background"
                      value={moveLimit}
                      onChange={(e) => setMoveLimit(Math.max(1, Number(e.target.value) || 1))}
                      disabled={tournamentRunning}
                    />
                  </div>
                </div>

                {/* Progress Bar & Actions */}
                <div className="space-y-2 pt-2 border-t">
                  {tournamentRunning && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-medium">
                        <span className="text-muted-foreground">{rrProgress || 'Simulating tournament matches...'}</span>
                        <span className="text-primary font-bold">{progressPercent}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-primary h-2 transition-all duration-300 ease-out"
                          style={{ width: `${progressPercent}%` }}
                        ></div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      onClick={runTournament}
                      size="sm"
                      className="text-xs font-semibold bg-primary text-primary-foreground"
                      disabled={tournamentRunning || selectedBots.length < 2}
                    >
                      {tournamentRunning ? '⏳ Simulating Tournament…' : '🏆 Run Tournament'}
                    </Button>
                    {tournamentRunning && (
                      <Button onClick={stopTournament} variant="destructive" size="sm" className="text-xs">
                        ⏹ Stop Simulation
                      </Button>
                    )}
                    {selectedBots.length < 2 && (
                      <span className="text-xs text-destructive font-medium">Select at least 2 entrants to start.</span>
                    )}
                  </div>
                </div>

                {error && <p className="text-xs text-destructive bg-destructive/10 p-2.5 rounded border">{error}</p>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Tournament Results Section */}
      {mode === 'tournament' && (
        <div className="space-y-6">
          {/* Round-Robin Standings Table */}
          {format === 'round-robin' && rrStandings.length > 0 && (
            <Card>
              <CardHeader className="py-4 border-b">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <span>📊 Round Robin Standings</span>
                      <Badge variant="outline" className="text-xs font-normal">
                        {rrPairings.length} Total Matches
                      </Badge>
                    </CardTitle>
                    {rrProgress && <CardDescription className="mt-0.5">{rrProgress}</CardDescription>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="bg-muted/50 border-b text-muted-foreground uppercase font-semibold">
                        <th className="py-2.5 px-4 w-12 text-center">#</th>
                        <th className="py-2.5 px-4">Bot Username</th>
                        <th className="py-2.5 px-4 text-center">Wins</th>
                        <th className="py-2.5 px-4 text-center">Losses</th>
                        <th className="py-2.5 px-4 text-center">Points</th>
                        <th className="py-2.5 px-4 text-center">Win Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rrStandings.map((s, i) => {
                        const isCurrent = CURRENT_SEASON_BOTS.has(s.bot);
                        const totalMatches = s.wins + s.losses;
                        const winRate = totalMatches > 0 ? Math.round((s.wins / totalMatches) * 100) : 0;
                        const isTop1 = i === 0;
                        const isTop2 = i === 1;
                        const isTop3 = i === 2;

                        return (
                          <tr key={s.bot} className={`hover:bg-muted/30 transition-colors ${isTop1 ? 'bg-amber-500/5' : ''}`}>
                            <td className="py-2 px-4 font-bold text-center">
                              {isTop1 ? '🥇 1' : isTop2 ? '🥈 2' : isTop3 ? '🥉 3' : i + 1}
                            </td>
                            <td className="py-2 px-4 font-medium flex items-center gap-2">
                              <span>{s.bot}</span>
                              {isCurrent && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                                  2026 Season
                                </Badge>
                              )}
                            </td>
                            <td className="py-2 px-4 text-center text-emerald-600 font-semibold">{s.wins}</td>
                            <td className="py-2 px-4 text-center text-rose-500">{s.losses}</td>
                            <td className="py-2 px-4 text-center font-bold">{s.points}</td>
                            <td className="py-2 px-4 text-center text-muted-foreground">{winRate}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Double Elimination Bracket Display */}
          {format === 'double-elimination' && bracket.length > 0 && (
            <Card>
              <CardHeader className="py-4 border-b">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <span>🌿 Double Elimination Bracket</span>
                      {bracketChampion && (
                        <Badge variant="default" className="bg-amber-500 text-white font-bold text-xs">
                          🏆 Champion: {bracketChampion}
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-0.5">
                      Clean structured bracket view of winners, losers, and grand final matches.
                    </CardDescription>
                  </div>

                  {/* Bracket Kind Tabs */}
                  <div className="flex items-center gap-1 bg-muted p-1 rounded-lg border text-xs">
                    {(['all', 'WB', 'LB', 'GF'] as const).map((tab) => (
                      <button
                        key={tab}
                        className={`px-2.5 py-1 rounded font-medium transition-colors ${
                          bracketTab === tab ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                        }`}
                        onClick={() => setBracketTab(tab)}
                      >
                        {tab === 'all' ? 'All Matches' : tab === 'WB' ? 'Winners Bracket' : tab === 'LB' ? 'Losers Bracket' : 'Grand Final'}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-4 space-y-6">
                {(['WB', 'LB', 'GF'] as const).map((kind) => {
                  if (bracketTab !== 'all' && bracketTab !== kind) return null;
                  const matches = bracket.filter((m) => m.bracket === kind);
                  if (matches.length === 0) return null;

                  const title = kind === 'WB' ? 'Winners Bracket' : kind === 'LB' ? 'Losers Bracket' : 'Grand Final';
                  const badgeColor = kind === 'WB' ? 'border-blue-500/30 text-blue-600 bg-blue-500/10' : kind === 'LB' ? 'border-amber-500/30 text-amber-600 bg-amber-500/10' : 'border-emerald-500/30 text-emerald-600 bg-emerald-500/10';

                  // Group matches by round index
                  const roundMap = new Map<number, TournamentMatch[]>();
                  for (const m of matches) {
                    const r = m.round;
                    if (!roundMap.has(r)) roundMap.set(r, []);
                    roundMap.get(r)!.push(m);
                  }
                  const roundNumbers = Array.from(roundMap.keys()).sort((a, b) => a - b);

                  return (
                    <div key={kind} className="space-y-3">
                      <div className="flex items-center gap-2 pb-1 border-b">
                        <Badge variant="outline" className={`text-xs font-semibold ${badgeColor}`}>
                          {title}
                        </Badge>
                        <span className="text-xs text-muted-foreground">({matches.length} matches)</span>
                      </div>

                      {/* Horizontally scrollable round columns */}
                      <div className="flex gap-4 overflow-x-auto pb-3 pt-1">
                        {roundNumbers.map((rNum) => {
                          const roundMatches = roundMap.get(rNum)!;
                          return (
                            <div key={rNum} className="flex-shrink-0 w-64 space-y-2">
                              <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider px-1">
                                {kind === 'GF' ? 'Final Series' : `Round ${rNum + 1}`}
                              </div>
                              <div className="space-y-2">
                                {roundMatches.map((m) => (
                                  <div
                                    key={m.id}
                                    className={`p-2.5 rounded-lg border text-xs bg-card transition-all ${
                                      m.status === 'done' ? 'border-border shadow-2xs' : 'border-primary/40 bg-primary/5 ring-1 ring-primary/20'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5 font-mono">
                                      <span>Match #{m.id}</span>
                                      {m.scoreSummary && (
                                        <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1 py-0.5 rounded border border-amber-500/20">
                                          {m.scoreSummary}
                                        </span>
                                      )}
                                      <Badge
                                        variant="outline"
                                        className={`text-[9px] px-1 py-0 ${
                                          m.status === 'done' ? 'bg-muted text-muted-foreground' : m.status === 'ready' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : 'bg-muted/50 text-muted-foreground'
                                        }`}
                                      >
                                        {m.status.toUpperCase()}
                                      </Badge>
                                    </div>

                                    {/* Player A */}
                                    <div
                                      className={`flex items-center justify-between py-1 px-2 rounded font-mono ${
                                        m.winner === m.a && m.a ? 'bg-emerald-500/15 font-bold text-emerald-700 dark:text-emerald-300' : m.loser === m.a && m.a ? 'text-muted-foreground opacity-75' : ''
                                      }`}
                                    >
                                      <span className="truncate max-w-[170px]" title={m.a ?? 'Bye / Pending'}>
                                        {m.a ?? <em className="text-muted-foreground text-[11px]">Pending</em>}
                                      </span>
                                      {m.winner === m.a && m.a && <span className="text-emerald-600 font-bold ml-1">✓ W</span>}
                                    </div>

                                    {/* Player B */}
                                    <div
                                      className={`flex items-center justify-between py-1 px-2 rounded font-mono mt-1 ${
                                        m.winner === m.b && m.b ? 'bg-emerald-500/15 font-bold text-emerald-700 dark:text-emerald-300' : m.loser === m.b && m.b ? 'text-muted-foreground opacity-75' : ''
                                      }`}
                                    >
                                      <span className="truncate max-w-[170px]" title={m.b ?? 'Bye / Pending'}>
                                        {m.b ?? <em className="text-muted-foreground text-[11px]">Pending</em>}
                                      </span>
                                      {m.winner === m.b && m.b && <span className="text-emerald-600 font-bold ml-1">✓ W</span>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Terminal-Style Match Log */}
          {tournamentLog.length > 0 && (
            <Card className="overflow-hidden border-slate-800 bg-slate-950 text-slate-100 shadow-md">
              <CardHeader className="py-2.5 px-4 bg-slate-900 border-b border-slate-800 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-mono font-semibold flex items-center gap-2 text-emerald-400">
                  <span>💻 Tournament Execution Log</span>
                  <span className="text-[10px] text-slate-400">({tournamentLog.length} entries)</span>
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[10px] h-6 px-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                  onClick={() => setTournamentLog([])}
                >
                  Clear Log
                </Button>
              </CardHeader>
              <CardContent className="p-3">
                <div className="max-h-56 overflow-y-auto space-y-1 font-mono text-xs text-slate-300">
                  {tournamentLog.map((entry, i) => (
                    <div key={i} className="leading-relaxed hover:bg-slate-900/60 px-1 py-0.5 rounded transition-colors">
                      {entry.includes('🏆') ? (
                        <span className="text-amber-400 font-bold">{entry}</span>
                      ) : entry.includes('Winner:') ? (
                        <span className="text-emerald-400">{entry}</span>
                      ) : (
                        <span>{entry}</span>
                      )}
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
