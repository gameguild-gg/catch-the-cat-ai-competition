import { describe, it, expect } from 'vitest';
import { parseBotOutput } from './parseBotOutput';

describe('parseBotOutput', () => {
  it('parses happy path: board, time, move', () => {
    const out = '. . . . .\n # C . . .\n . . . . .\n123\n-3,4\n';
    expect(parseBotOutput(out)).toEqual({ move: { x: -3, y: 4 }, timeUs: 123, timeMs: 0.123 });
  });

  it('tolerates trailing whitespace and blank lines', () => {
    const out = 'board stuff\n  987  \n\n 0,0 \n\n\n';
    expect(parseBotOutput(out)).toEqual({ move: { x: 0, y: 0 }, timeUs: 987, timeMs: 0.987 });
  });

  it('throws when output is empty', () => {
    expect(() => parseBotOutput('   \n \n')).toThrow(
      'No move was returned - agent produced no output'
    );
  });

  it('throws when only one non-empty line', () => {
    expect(() => parseBotOutput('1,2')).toThrow('Expected at least 2 lines in output (time and move)');
  });

  it('throws on malformed move line', () => {
    expect(() => parseBotOutput('board\n123\nabc')).toThrow(
      'Could not parse move coordinates from: abc'
    );
  });

  it('throws on non-numeric time line', () => {
    expect(() => parseBotOutput('board\nabc\n1,2')).toThrow(
      'Could not parse processing time from: abc'
    );
  });
});
