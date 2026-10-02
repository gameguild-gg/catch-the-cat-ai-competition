// Single catch-the-cat match engine, extracted from Arena so both the
// single-match view and tournaments reuse the exact same worker loop.

import { Board, Turn, Position } from '../board';

export const BOARD_SIZE = 21;
export const MOVE_TIMEOUT_MS = 2000;
export const MOVE_DELAY_MS = 300;
export const MAX_MOVES = BOARD_SIZE * BOARD_SIZE;

export interface ArenaMove {
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

export type WinnerInfo = { side: 'cat' | 'catcher'; username: string };

export interface MatchOutcome {
  winner: WinnerInfo | null;
  moves: ArenaMove[];
  error: string | null;
}

export interface MatchProgress {
  board: string;
  cat: { x: number; y: number };
  moves: ArenaMove[];
}

export interface MatchOptions {
  /** Return true to abort the match as soon as possible. */
  isStopped?: () => boolean;
  /** Called on every board update (and once at match start). */
  onProgress?: (progress: MatchProgress) => void;
}

export function workerRequest(worker: Worker, msg: { type: 'load'; botUrl: string }, expect: 'ready', timeoutMs: number): Promise<{ type: 'ready' }>;
export function workerRequest(worker: Worker, msg: { type: 'move'; turn: 'cat' | 'catcher'; size: number; board: string }, expect: 'result', timeoutMs: number): Promise<{ type: 'result'; move: { x: number; y: number }; timeUs: number }>;
export function workerRequest(
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

/**
 * Play one match between `catBot` and `catcherBot` on `boardString`, reusing
 * the arena worker. Resolves with the winner (null if the provided stop signal
 * fired before the game ended), the move log and any error.
 */
export async function runSingleMatch(
  catBot: string,
  catcherBot: string,
  boardString: string,
  options: MatchOptions = {}
): Promise<MatchOutcome> {
  const { isStopped, onProgress } = options;
  const moves: ArenaMove[] = [];
  let error: string | null = null;
  let winner: WinnerInfo | null = null;

  const catWorker = new Worker(new URL('./arena.worker.ts', import.meta.url), { type: 'module' });
  const catcherWorker = new Worker(new URL('./arena.worker.ts', import.meta.url), { type: 'module' });

  const emit = (board: Board) => {
    onProgress?.({
      board: board.getBoardString(),
      cat: { x: board.catPosition.x, y: board.catPosition.y },
      moves: [...moves],
    });
  };

  try {
    await Promise.all([
      workerRequest(catWorker, { type: 'load', botUrl: `${import.meta.env.BASE_URL}bots/${catBot}.js` }, 'ready', MOVE_TIMEOUT_MS * 5),
      workerRequest(catcherWorker, { type: 'load', botUrl: `${import.meta.env.BASE_URL}bots/${catcherBot}.js` }, 'ready', MOVE_TIMEOUT_MS * 5),
    ]);

    const board = new Board(boardString, new Position(0, 0), catBot, catcherBot);
    emit(board);

    let moveCount = 0;

    while (moveCount < MAX_MOVES && !(isStopped?.() ?? false)) {
      const gameResult = board.getGameResult();
      if (gameResult.isOver) {
        if (gameResult.winner) {
          winner = {
            side: gameResult.winner === Turn.Cat ? 'cat' : 'catcher',
            username: gameResult.winner === Turn.Cat ? catBot : catcherBot,
          };
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
        moves.push({
          n: moveCount + 1,
          username,
          turn: board.turn,
          move: { x: 0, y: 0 },
          timeUs: undefined,
        });
        winner = {
          side: isCatTurn ? 'catcher' : 'cat',
          username: isCatTurn ? catcherBot : catBot,
        };
        error = failure ? `${username} failed: ${failure}` : null;
        emit(board);
        break;
      }

      try {
        board.move(new Position(result.move.x, result.move.y));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        moves.push({
          n: moveCount + 1,
          username,
          turn: board.turn,
          move: result.move,
          timeUs: result.timeUs,
        });
        winner = { side: isCatTurn ? 'catcher' : 'cat', username: isCatTurn ? catcherBot : catBot };
        error = `${username} invalid move: ${msg}`;
        emit(board);
        break;
      }

      moveCount++;
      moves.push({
        n: moveCount,
        username,
        turn: isCatTurn ? Turn.Cat : Turn.Catcher,
        move: { x: result.move.x, y: result.move.y },
        timeUs: result.timeUs,
      });
      emit(board);

      if (board.getGameResult().isOver) {
        const final = board.getGameResult();
        if (final.winner) {
          winner = {
            side: final.winner === Turn.Cat ? 'cat' : 'catcher',
            username: final.winner === Turn.Cat ? catBot : catcherBot,
          };
        }
        break;
      }

      await new Promise((r) => setTimeout(r, MOVE_DELAY_MS));
    }

    if (!(isStopped?.() ?? false) && !winner) {
      winner = { side: 'catcher', username: catcherBot };
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    catWorker.terminate();
    catcherWorker.terminate();
  }

  return { winner, moves, error };
}
