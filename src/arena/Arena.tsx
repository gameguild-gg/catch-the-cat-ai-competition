import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/select';
import { HexagonalBoard } from '../components/HexagonalBoard';
import { Board, Turn, Position } from '../board';

interface ArenaProps {}

interface ArenaMove {
  n: number;
  username: string;
  turn: Turn;
  move: { x: number; y: number };
  timeUs?: number;
}

type WorkerReply =
  | { type: 'ready' }
  | { type: 'result'; move: { x: number; y: number }; timeUs: number }
  | { type: 'error'; message: string };

const BOARD_SIZE = 21;
const MOVE_TIMEOUT_MS = 2000;
const MOVE_DELAY_MS = 300;
const MAX_MOVES = BOARD_SIZE * BOARD_SIZE;

function workerRequest(worker: Worker, msg: { type: 'load'; botUrl: string }, expect: 'ready', timeoutMs: number): Promise<{ type: 'ready' }>;
function workerRequest(worker: Worker, msg: { type: 'move'; turn: 'cat' | 'catcher'; size: number; board: string }, expect: 'result', timeoutMs: number): Promise<{ type: 'result'; move: { x: number; y: number }; timeUs: number }>;
function workerRequest(
  worker: Worker,
  msg: { type: 'load'; botUrl: string } | { type: 'move'; turn: 'cat' | 'catcher'; size: number; board: string },
  expect: 'ready' | 'result',
  timeoutMs: number
): Promise<{ type: 'ready' } | { type: 'result'; move: { x: number; y: number }; timeUs: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.removeEventListener('message', onMsg);
      reject(new Error(`Timeout after ${timeoutMs}ms waiting for '${expect}'`));
    }, timeoutMs);
    const onMsg = (e: MessageEvent<WorkerReply>) => {
      const d = e.data;
      if (d.type === 'error') {
        clearTimeout(timer);
        worker.removeEventListener('message', onMsg);
        reject(new Error(d.message));
        return;
      }
      if (d.type !== expect) return;
      clearTimeout(timer);
      worker.removeEventListener('message', onMsg);
      resolve(d);
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage(msg);
  });
}

export function Arena({}: ArenaProps) {
  const [bots, setBots] = useState<string[] | null>(null);
  const [catBot, setCatBot] = useState('');
  const [catcherBot, setCatcherBot] = useState('');
  const [boardString, setBoardString] = useState(() => Board.generateRandomBoard(BOARD_SIZE));
  const [boardText, setBoardText] = useState('');
  const [boardError, setBoardError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [moves, setMoves] = useState<ArenaMove[]>([]);
  const [displayBoard, setDisplayBoard] = useState<string | null>(null);
  const [displayCat, setDisplayCat] = useState({ x: 0, y: 0 });
  const [winner, setWinner] = useState<{ side: 'cat' | 'catcher'; username: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

    const catWorker = new Worker(new URL('./arena.worker.ts', import.meta.url), { type: 'module' });
    const catcherWorker = new Worker(new URL('./arena.worker.ts', import.meta.url), { type: 'module' });

    try {
      // Load both bots
      await Promise.all([
        workerRequest(catWorker, { type: 'load', botUrl: `${import.meta.env.BASE_URL}bots/${catBot}.js` }, 'ready', MOVE_TIMEOUT_MS * 5),
        workerRequest(catcherWorker, { type: 'load', botUrl: `${import.meta.env.BASE_URL}bots/${catcherBot}.js` }, 'ready', MOVE_TIMEOUT_MS * 5),
      ]);

      const board = new Board(boardString, new Position(0, 0), catBot, catcherBot);
      setDisplayBoard(board.getBoardString());
      setDisplayCat({ x: 0, y: 0 });

      let moveCount = 0;
      let localMoves: ArenaMove[] = [];

      while (moveCount < MAX_MOVES && !stopRef.current) {
        const gameResult = board.getGameResult();
        if (gameResult.isOver) {
          if (gameResult.winner) {
            setWinner({
              side: gameResult.winner === Turn.Cat ? 'cat' : 'catcher',
              username: gameResult.winner === Turn.Cat ? catBot : catcherBot,
            });
          }
          break;
        }

        const isCatTurn = board.turn === Turn.Cat;
        const worker = isCatTurn ? catWorker : catcherWorker;
        const username = isCatTurn ? catBot : catcherBot;

        let result: Extract<WorkerReply, { type: 'result' }> | null = null;
        let failure: string | null = null;
        try {
          result = await workerRequest(
            worker,
            { type: 'move', turn: isCatTurn ? 'cat' : 'catcher', size: BOARD_SIZE, board: board.getBoardString() },
            'result',
            MOVE_TIMEOUT_MS
          );
        } catch (e) {
          failure = e instanceof Error ? e.message : String(e);
        }

        if (failure || !result) {
          // Timeout or worker error → other side wins immediately
          setMoves((m) => [
            ...m,
            {
              n: moveCount + 1,
              username,
              turn: board.turn,
              move: { x: 0, y: 0 },
              timeUs: undefined,
            },
          ]);
          setWinner({
            side: isCatTurn ? 'catcher' : 'cat',
            username: isCatTurn ? catcherBot : catBot,
          });
          setError(failure ? `${username} failed: ${failure}` : null);
          break;
        }

        try {
          board.move(new Position(result.move.x, result.move.y));
        } catch (e) {
          // Invalid move → other side wins
          const msg = e instanceof Error ? e.message : String(e);
          setMoves((m) => [
            ...m,
            {
              n: moveCount + 1,
              username,
              turn: board.turn,
              move: result!.move,
              timeUs: result!.timeUs,
            },
          ]);
          setWinner({ side: isCatTurn ? 'catcher' : 'cat', username: isCatTurn ? catcherBot : catBot });
          setError(`${username} invalid move: ${msg}`);
          break;
        }

        moveCount++;
        const newMove: ArenaMove = {
          n: moveCount,
          username,
          turn: isCatTurn ? Turn.Cat : Turn.Catcher,
          move: { x: result.move.x, y: result.move.y },
          timeUs: result.timeUs,
        };
        localMoves = [...localMoves, newMove];
        setMoves(localMoves);
        setDisplayBoard(board.getBoardString());
        setDisplayCat({ x: board.catPosition.x, y: board.catPosition.y });

        if (board.getGameResult().isOver) {
          const final = board.getGameResult();
          if (final.winner) {
            setWinner({
              side: final.winner === Turn.Cat ? 'cat' : 'catcher',
              username: final.winner === Turn.Cat ? catBot : catcherBot,
              });
          }
          break;
        }

        await new Promise((r) => setTimeout(r, MOVE_DELAY_MS));
      }

      if (!stopRef.current && !winner) {
        // 441-move cap reached without a game-over: catcher wins by not losing
        setWinner((w) => w ?? { side: 'catcher', username: catcherBot });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      catWorker.terminate();
      catcherWorker.terminate();
      setRunning(false);
    }
  }, [catBot, catcherBot, boardString]);

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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">⚔️ Arena</CardTitle>
          <CardDescription>Watch two bots play catch the cat live in your browser</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: board */}
            <div className="bg-muted rounded border overflow-x-auto">
              <HexagonalBoard boardString={boardForDisplay} catPosition={catPos} />
            </div>

            {/* Right: controls + moves */}
            <div className="space-y-4">
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
                  <Button onClick={loadBoard} variant="outline" size="sm" disabled={running}>
                    Load board
                  </Button>
                </div>
                <textarea
                  readOnly={running}
                  value={boardText || boardString}
                  onChange={(e) => setBoardText(e.target.value)}
                  className={`w-full h-24 font-mono text-xs p-2 rounded border break-all ${
                    boardError ? 'border-red-500' : 'border-input bg-background'
                  }`}
                />
                {boardError && <p className="text-sm text-destructive">{boardError}</p>}
              </div>

              <div className="flex items-center gap-2">
                <Button onClick={runMatch} disabled={running || !catBot || !catcherBot || catBot === catcherBot}>
                  {running ? 'Running…' : 'Run Match'}
                </Button>
                {running && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      stopRef.current = true;
                    }}
                  >
                    Stop
                  </Button>
                )}
              </div>

              {winner && (
                <div className="p-3 bg-green-50 border border-green-200 rounded text-sm">
                  🏆 {winner.side === 'cat' ? `Cat ${winner.username} escapes!` : `Catcher ${winner.username} wins!`}
                  <span className="ml-2 text-muted-foreground">({moves.length} moves)</span>
                </div>
              )}
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-destructive break-words">
                  {error}
                </div>
              )}

              <div className="space-y-1 max-h-72 overflow-y-auto">
                {moves.map((m) => (
                  <div key={m.n} className="text-xs font-mono flex items-center gap-2">
                    <span className="text-muted-foreground w-8">{m.n}.</span>
                    <Badge variant={m.turn === 'cat' ? 'default' : 'secondary'}>{m.username}</Badge>
                    <span>
                      → ({m.move.x},{m.move.y})
                    </span>
                    {m.timeUs !== undefined && (
                      <span className="text-muted-foreground">[{(m.timeUs / 1000).toFixed(1)}ms]</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
