// Web Worker: loads a catch-the-cat bot WASM module and executes moves on demand.
// Runs in a separate thread to avoid blocking the UI during computation.
// Mirrors the chess-competition bot-worker pattern.

import { parseBotOutput } from './parseBotOutput';

interface BotModule {
  callMain(argv: string[]): number;
}

interface BotFactoryOverrides {
  print: (text: string) => void;
  printErr: (text: string) => void;
}

type BotFactory = (overrides: BotFactoryOverrides) => Promise<BotModule>;

type InMsg =
  | { type: 'load'; botUrl: string }
  | { type: 'move'; turn: 'cat' | 'catcher'; size: number; board: string };

type OutMsg =
  | { type: 'ready' }
  | { type: 'result'; move: { x: number; y: number }; timeUs: number }
  | { type: 'error'; message: string };

let factory: BotFactory | null = null;
let botInstance: BotModule | null = null;
const outLines: string[] = [];

function post(msg: OutMsg): void {
  self.postMessage(msg);
}

function isExitStatus(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    ((err as { name?: string }).name === 'ExitStatus' || (err as { status?: number }).status === 0)
  );
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;

  if (msg.type === 'load') {
    try {
      // Dynamically import the Emscripten ES6 module
      const mod = await import(/* @vite-ignore */ msg.botUrl);
      factory = mod.default as BotFactory;
      botInstance = await factory({
        print: (t: string) => outLines.push(t),
        printErr: () => {},
      });
      post({ type: 'ready' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      post({ type: 'error', message: `Failed to load bot: ${message}` });
    }
    return;
  }

  if (msg.type === 'move') {
    if (!botInstance) {
      if (factory) {
        try {
          botInstance = await factory({
            print: (t: string) => outLines.push(t),
            printErr: () => {},
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          post({ type: 'error', message: `Failed to instantiate bot: ${message}` });
          return;
        }
      } else {
        post({ type: 'error', message: 'Bot not loaded' });
        return;
      }
    }

    // callMain() prepends the program name itself (argv[0]), so pass only real args.
    const argv = [
      '--headless',
      '--turn',
      msg.turn,
      '--size',
      String(msg.size),
      '--board',
      msg.board,
    ];
    outLines.length = 0;

    try {
      botInstance.callMain(argv);
    } catch (err: unknown) {
      if (!isExitStatus(err)) {
        const message = err instanceof Error ? err.message : String(err);
        post({ type: 'error', message: `Bot execution error: ${message}` });
        return;
      }
    }

    try {
      const result = parseBotOutput(outLines.join('\n'));
      post({ type: 'result', move: result.move, timeUs: result.timeUs });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      post({ type: 'error', message: `Failed to parse bot output: ${message}` });
    }
  }
};
