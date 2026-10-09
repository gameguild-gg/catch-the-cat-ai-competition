import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/select';
import { HexagonalBoard } from '../components/HexagonalBoard';
import { Board, Position, Turn } from '../board';
import { workerRequest, botUrl, MOVE_TIMEOUT_MS, BOARD_SIZE } from '../arena/match';

type Role = 'cat' | 'catcher';
type Status = 'idle' | 'loading' | 'playing' | 'thinking' | 'over';

interface LogEntry {
  n: number;
  who: string;
  turn: Turn;
  move: { x: number; y: number };
}

function hexNeighbors(p: { x: number; y: number }): { x: number; y: number }[] {
  // matches Board's NE/NW/SE/SW hex parity from src/board.ts
  const odd = p.y % 2 !== 0;
  return [
    { x: p.x + 1, y: p.y },
    { x: p.x - 1, y: p.y },
    { x: odd ? p.x + 1 : p.x, y: p.y - 1 },
    { x: odd ? p.x : p.x - 1, y: p.y - 1 },
    { x: odd ? p.x : p.x - 1, y: p.y + 1 },
    { x: odd ? p.x + 1 : p.x, y: p.y + 1 },
  ];
}

export function PlayVsBot({ deepLink }: { deepLink?: { bot: string; role: Role } }) {
  const [bots, setBots] = useState<string[] | null>(null);
  const [selectedBot, setSelectedBot] = useState('');
  const [userRole, setUserRole] = useState<Role>('cat');
  const [status, setStatus] = useState<Status>('idle');
  const [boardString, setBoardString] = useState('');
  const [catPosition, setCatPosition] = useState({ x: 0, y: 0 });
  const [winner, setWinner] = useState<{ who: string; side: 'cat' | 'catcher' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moves, setMoves] = useState<LogEntry[]>([]);

  const boardRef = useRef<Board | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const gameIdRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}bots/manifest.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const names: string[] = (data.bots || []).map((b: { username: string }) => b.username);
        setBots(names);
        if (deepLink && names.includes(deepLink.bot)) {
          setSelectedBot(deepLink.bot);
          setUserRole(deepLink.role);
        } else if (names.length > 0) setSelectedBot(names[0]);
      })
      .catch(() => setBots([]));
    return () => {
      try { workerRef.current?.terminate(); } catch {}
      workerRef.current = null;
    };
  }, []);

  const syncDisplay = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    setBoardString(board.getBoardString());
    setCatPosition({ x: board.catPosition.x, y: board.catPosition.y });
  }, []);

  const logMove = useCallback((who: string, turn: Turn, move: { x: number; y: number }) => {
    setMoves((prev) => [...prev, { n: prev.length + 1, who, turn, move }].slice(-10));
  }, []);

  const finishIfOver = useCallback((): boolean => {
    const board = boardRef.current;
    if (!board) return false;
    const result = board.getGameResult();
    if (!result.isOver) return false;
    setStatus('over');
    if (result.winner) {
      const userWon = (result.winner === Turn.Cat) === (userRole === 'cat');
      setWinner({ who: userWon ? 'You' : selectedBot, side: result.winner === Turn.Cat ? 'cat' : 'catcher' });
    }
    return true;
  }, [userRole, selectedBot]);

  const botTurn = useCallback(async (gameId: number): Promise<void> => {
    const board = boardRef.current;
    const worker = workerRef.current;
    if (!board || !worker) return;
    setStatus('thinking');
    const botTurnIsCat = board.turn === Turn.Cat;
    try {
      const result = await workerRequest(
        worker,
        { type: 'move', turn: botTurnIsCat ? 'cat' : 'catcher', size: BOARD_SIZE, board: board.getBoardString() },
        'result',
        MOVE_TIMEOUT_MS
      );
      if (gameIdRef.current !== gameId || status === 'over') return;
      board.move(new Position(result.move.x, result.move.y));
      logMove(selectedBot, board.turn === Turn.Cat ? Turn.Catcher : Turn.Cat, result.move);
      syncDisplay();
      if (!finishIfOver()) setStatus('playing');
    } catch {
      if (gameIdRef.current !== gameId) return;
      setStatus('over');
      setWinner({ who: 'You', side: userRole });
      setError(`${selectedBot} failed to move — you win by default`);
    }
  }, [selectedBot, userRole, logMove, syncDisplay, finishIfOver, status]);

  const newGame = useCallback(async (bot?: string, role?: Role) => {
    const opponent = bot ?? selectedBot;
    const playAs = role ?? userRole;
    if (!opponent) return;
    window.history.replaceState(null, '', `?${playAs === 'cat' ? 'catcher' : 'cat'}=${encodeURIComponent(opponent)}`);
    const gameId = ++gameIdRef.current;
    busyRef.current = false;
    setWinner(null);
    setError(null);
    setMoves([]);
    setStatus('loading');

    try {
      if (workerRef.current) {
        try { workerRef.current.terminate(); } catch {}
      }
      const worker = new Worker(new URL('../arena/arena.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      await workerRequest(worker, { type: 'load', botUrl: botUrl(opponent) }, 'ready', MOVE_TIMEOUT_MS * 5);
      if (gameIdRef.current !== gameId) return;

      const board = new Board(Board.generateRandomBoard(BOARD_SIZE), new Position(0, 0), playAs === 'cat' ? 'You' : opponent, playAs === 'cat' ? opponent : 'You');
      boardRef.current = board;
      syncDisplay();
      setStatus('playing');
      if (playAs === 'catcher') {
        await botTurn(gameId);
      }
    } catch (e) {
      if (gameIdRef.current !== gameId) return;
      setStatus('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedBot, userRole, syncDisplay, botTurn]);

  const didAutoStartRef = useRef(false);

  useEffect(() => {
    if (bots === null || !deepLink || didAutoStartRef.current) return;
    if (!bots.includes(deepLink.bot)) return;
    didAutoStartRef.current = true;
    void newGame(deepLink.bot, deepLink.role);
  }, [bots, deepLink, newGame]);

  const onCellClick = useCallback((x: number, y: number) => {
    const board = boardRef.current;
    if (!board || status !== 'playing' || busyRef.current) return;
    const userTurn = board.turn === Turn.Cat ? 'cat' : 'catcher';
    if (userTurn !== userRole) return;
    const pos = new Position(x, y);
    if (!board.validateMove(pos)) return;
    busyRef.current = true;
    board.move(pos);
    logMove('You', userRole === 'cat' ? Turn.Cat : Turn.Catcher, { x, y });
    syncDisplay();
    busyRef.current = false;
    if (finishIfOver()) return;
    void botTurn(gameIdRef.current);
  }, [status, userRole, logMove, syncDisplay, finishIfOver, botTurn]);

  const highlightCells = (() => {
    const board = boardRef.current;
    if (!board || status !== 'playing') return undefined;
    if (userRole !== 'cat' || board.turn !== Turn.Cat) return undefined;
    const cells = new Set<string>();
    for (const n of hexNeighbors(board.catPosition)) {
      if (board.validateMove(new Position(n.x, n.y))) cells.add(`${n.x},${n.y}`);
    }
    return cells;
  })();

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
          <CardTitle>No Bots Found</CardTitle>
          <CardDescription>
            Run <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">npm run build:bots</code> to build bot binaries first.
          </CardDescription>
        </CardContent>
      </Card>
    );
  }

  const canStart = selectedBot !== '' && (status === 'idle' || status === 'over');
  const yourTurn = status === 'playing' && boardRef.current !== null && ((boardRef.current.turn === Turn.Cat) === (userRole === 'cat'));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-5 space-y-4">
        <Card className="overflow-hidden">
          <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Match Board</CardTitle>
            {status === 'thinking' && (
              <span className="text-xs text-muted-foreground animate-pulse">{selectedBot} is thinking…</span>
            )}
            {yourTurn && <span className="text-xs font-medium text-primary">Your turn</span>}
          </CardHeader>
          <CardContent className="p-3 flex justify-center bg-slate-900/5 dark:bg-slate-900/40">
            {boardString ? (
              <div className="w-full max-w-[420px]">
                <HexagonalBoard
                  boardString={boardString}
                  catPosition={catPosition}
                  onCellClick={status === 'playing' ? onCellClick : undefined}
                  highlightCells={highlightCells}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground p-8">Pick a bot and your role, then start a new game.</p>
            )}
          </CardContent>
        </Card>

        {moves.length > 0 && (
          <Card>
            <CardHeader className="py-2.5 px-4 bg-muted/30 border-b">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Moves ({moves.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-48 overflow-y-auto divide-y text-xs font-mono">
                {moves.slice().reverse().map((m) => (
                  <div key={m.n} className="flex items-center justify-between px-3 py-1.5">
                    <span className={m.who === 'You' ? 'font-medium text-primary' : 'text-muted-foreground'}>
                      {m.n}. {m.who} ({m.turn === Turn.Cat ? 'cat' : 'catcher'})
                    </span>
                    <span className="font-semibold">({m.move.x}, {m.move.y})</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="lg:col-span-7 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Play vs Bot</CardTitle>
            <CardDescription>
              {status === 'idle' || status === 'over'
                ? 'Select an opponent and your side, then start a game.'
                : userRole === 'cat'
                  ? 'You are the cat — click a highlighted hex to move. Reach the edge to win.'
                  : 'You are the catcher — click any empty hex to block it. Trap the cat to win.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold">Opponent Bot</label>
                <Select value={selectedBot} onChange={(e) => setSelectedBot(e.target.value)} disabled={status === 'playing' || status === 'thinking' || status === 'loading'}>
                  {bots.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold">Your Role</label>
                <Select value={userRole} onChange={(e) => setUserRole(e.target.value as Role)} disabled={status === 'playing' || status === 'thinking' || status === 'loading'}>
                  <option value="cat">Cat</option>
                  <option value="catcher">Catcher</option>
                </Select>
              </div>
            </div>

            <Button onClick={() => void newGame()} disabled={!canStart} className="font-semibold">
              {status === 'loading' ? 'Loading bot…' : 'New Game'}
            </Button>

            {winner && (
              <div className="rounded-lg border p-3 text-sm flex items-center gap-2">
                <span className="font-bold">{winner.who === 'You' ? 'You won' : `${winner.who} won`}</span>
                <span className="text-muted-foreground">({winner.side} side)</span>
              </div>
            )}
            {error && <p className="text-xs text-destructive bg-destructive/10 p-2.5 rounded border">{error}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default PlayVsBot;
