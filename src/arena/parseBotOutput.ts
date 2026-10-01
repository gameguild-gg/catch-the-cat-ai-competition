// Pure parser for bot stdout — mirrors parseMoveAndTimeFromOutput in generateReport.ts.
// The C++ program prints:
// 1. Board state after the move
// 2. Processing time (microseconds)
// 3. Move coordinates (x,y)

export interface ParsedBotOutput {
  move: { x: number; y: number };
  /** Raw processing time in microseconds, as printed by the agent. */
  timeUs: number;
  /** Convenience value in milliseconds for UI display. */
  timeMs: number;
}

export function parseBotOutput(stdout: string): ParsedBotOutput {
  const lines = stdout.trim().split('\n');

  // Find the last two non-empty lines (reversed: [0] = move, [1] = time)
  const nonEmptyLines = lines.filter((line) => line.trim()).reverse();

  if (nonEmptyLines.length === 0) {
    throw new Error('No move was returned - agent produced no output');
  }

  if (nonEmptyLines.length < 2) {
    throw new Error('Expected at least 2 lines in output (time and move)');
  }

  // Parse move coordinates from the last line (format: "x,y")
  const moveLineMatch = nonEmptyLines[0].trim().match(/^(-?\d+),(-?\d+)$/);
  if (!moveLineMatch) {
    throw new Error(`Could not parse move coordinates from: ${nonEmptyLines[0]}`);
  }

  const move = {
    x: parseInt(moveLineMatch[1], 10),
    y: parseInt(moveLineMatch[2], 10),
  };

  // Parse processing time from the second-to-last line
  const timeUs = parseFloat(nonEmptyLines[1].trim());
  if (isNaN(timeUs)) {
    throw new Error(`Could not parse processing time from: ${nonEmptyLines[1]}`);
  }

  return { move, timeUs, timeMs: timeUs / 1000 };
}
