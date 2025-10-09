import { execSync, exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Board, MatchReport, Position, Turn, MoveReport, UserScore, CompetitionReport } from './src/board.ts';

// Track active child processes for cleanup


/**
 * Get the optimal number of CPU cores for parallel compilation
 * Uses all available cores but caps at a reasonable maximum to avoid overwhelming the system
 */
function getOptimalParallelJobs(): number {
  const cpuCount = os.cpus().length;
  // Use all cores but cap at 16 to avoid overwhelming the system
  // Leave one core free for system processes if we have more than 2 cores
  if (cpuCount <= 2)
    return cpuCount;
  else
    return cpuCount - 1;
}

export class UserRepository {
  username: string = '';
  repo: string = '';
}

export let users: UserRepository[] = [{
    username: 'DPS2004',
    repo: 'https://github.com/DPS2004/mobagen',
}, { 
  username: "Ceichert31",
  repo: "https://github.com/Ceichert31/GameAI-Interactive"
}, {
    username: 'BrandonCherry166',
    repo: 'https://github.com/BrandonCherry166/mobagen',
}, {
    username: 'ZackOlson',
    repo: 'https://github.com/ZackOlson/mobagen',
}, {
    username: 'Fable-Spagat',
    repo: 'https://github.com/Fable-Spagat/mobagen',
}, {
    username: 'StevenSpyro',
    repo: 'https://github.com/StevenSpyro/mobagen',
}, {
    username: 'Jingles5',
    repo: 'https://github.com/Jingles5/mobagen',
}, {
    username: 'pricedown',
    repo: 'https://github.com/pricedown/mobagen',
}, {
    username: 'blade-x7',
    repo: 'https://github.com/blade-x7/mobagen',
}, {
    username: "Nominal9977",
    repo: "https://github.com/Nominal9977/mobagen"
}, { 
    username: "AndrewGenualdo",
    repo: "https://github.com/AndrewGenualdo/ai4games-mobagen"
}, {
    username:  "TOAG21",
    repo: "https://github.com/TOAG21/mobagen"
}, {
    username: "AnderzBruh",
    repo: "https://github.com/AnderzBruh/mobagen"
}, { 
  username: "noahfreedz",
  repo: "https://github.com/noahfreedz/AI-4-G-MOBAGEN"
}, { 
  username: "KFireheart",
  repo: "https://github.com/KFireheart/AI-For-Games-mobagen"
}, {
  username: "Cosmey",
  repo: "https://github.com/Cosmey/mobagenReeceEnthoven"
}, {
  username: "carreon-as-usual",
  repo: "https://github.com/carreon-as-usual/mobagen"
},
{
  username: "conorbyrne1",
  repo: "https://github.com/conorbyrne1/mobagenfork"
},
{
  username: "AnthonySpering",
  repo: "https://github.com/AnthonySpering/mobagen"
}
];

interface MoveResult {
  move: Position | null;
  time: number;
  error?: string;
}

interface ParseResult {
  move: Position;
  processingTime: number;
}

async function requestMove(board: Board, user: UserRepository): Promise<MoveResult> {
  const startTime = Date.now();
  const timeout = 2000; // 2 second timeout
  
  try {
    // Prepare the board string with cat position marked as 'C'
    const boardString = board.getBoardString();
    const turn = board.turn === Turn.Cat ? 'cat' : 'catcher';
    const executablePath = path.join('repos', user.username, 'build', 'bin', 'catchthecat');
    
    // Command: catchthecat --headless --turn <cat|catcher> --size <size> --board <board_string>
    const command = `${executablePath} --headless --turn ${turn} --size ${board.side} --board "${boardString}"`;
    
    return new Promise((resolve) => {
      let resolved = false;
      let timeoutHandle: NodeJS.Timeout | null = null;
      
      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };
      
      const safeResolve = (result: MoveResult) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(result);
        }
      };
      
      const child = exec(command, { 
        timeout,
        killSignal: 'SIGKILL' // Use SIGKILL to ensure process termination
      }, (error, stdout, stderr) => {
        const endTime = Date.now();
        const executionTime = endTime - startTime;
        
        if (error) {
           if (error.signal === 'SIGTERM' || error.signal === 'SIGKILL' || error.message.includes('timeout')) {
             safeResolve({ move: null, time: timeout, error: 'Timeout exceeded' });
           } else {
             safeResolve({ move: null, time: executionTime, error: error.message });
           }
           return;
         }
        
        try {
          // Parse the output to extract both the move and processing time
          // The C++ code now prints the board state after the move, followed by processing time
          const result = parseMoveAndTimeFromOutput(stdout, board);
          
          // Check if the execution time exceeded the timeout, even if the process completed
          if (executionTime >= timeout) {
            safeResolve({ move: null, time: timeout, error: 'Timeout exceeded' });
          } else {
            safeResolve({ 
              move: result.move, 
              time: result.processingTime // Use processing time from C++ program
            });
          }
        } catch (parseError) {
          safeResolve({ move: null, time: executionTime, error: `Parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}` });
        }
      });
      
      // Set up timeout to kill process immediately
       timeoutHandle = setTimeout(() => {
         if (!resolved && child && !child.killed) {
           // Kill the process immediately with SIGKILL for timeout
           try {
             child.kill('SIGKILL');
           } catch (error) {
             console.warn(`Failed to kill timed-out process: ${error}`);
           }
           safeResolve({ move: null, time: timeout, error: 'Timeout exceeded' });
         }
       }, timeout);
       
       // Handle process errors
       child.on('error', (err) => {
         safeResolve({ move: null, time: Date.now() - startTime, error: `Process error: ${err.message}` });
       });
    });
  } catch (error) {
    const endTime = Date.now();
    return { move: null, time: endTime - startTime, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseMoveAndTimeFromOutput(output: string, originalBoard: Board): ParseResult {
  // The C++ program now prints:
  // 1. Board state after the move
  // 2. Processing time (microseconds)
  // 3. Move coordinates (x,y)
  const lines = output.trim().split('\n');
  
  // Extract processing time and move from the last two non-empty lines
  let processingTime = 0;
  let move: Position = new Position(0, 0);
  
  // Find the last two non-empty lines
  const nonEmptyLines = lines.filter(line => line.trim()).reverse();
  
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
  
  move = new Position(
    parseInt(moveLineMatch[1], 10),
    parseInt(moveLineMatch[2], 10)
  );
  
  // Parse processing time from the second-to-last line
  const timeValue = parseFloat(nonEmptyLines[1].trim());
  if (isNaN(timeValue)) {
    throw new Error(`Could not parse processing time from: ${nonEmptyLines[1]}`);
  }
  processingTime = timeValue;
  
  return { move, processingTime };
}



function calculateTimePenalty(timeMicroseconds: number): number {
  // Convert microseconds to milliseconds first
  const timeMs = timeMicroseconds / 1000;
  // Cube root creates even more diminishing returns - being 2x slower has minimal impact
  // Divide by 5000 to scale very lightly (∛1000ms ≈ 10 → 0.002 penalty)
  return Math.cbrt(timeMs) / 5000;
}

async function runMatch(cat: UserRepository, catcher: UserRepository, initialState: string): Promise<MatchReport> {
  const report = new MatchReport();
  report.cat = cat.username;
  report.catcher = catcher.username;
  
  // Create initial board with cat at center
  const board = new Board(initialState, new Position(0, 0), cat.username, catcher.username);
  
  // Store initial state with board, cat position, and first turn
  report.initialState.board = initialState;
  report.initialState.catPosition = new Position(0, 0);
  report.initialState.turn = board.turn;
  let moveCount = 0;
  const maxMoves = board.side * board.side; // Maximum possible moves
  
  console.log(`Running match: ${cat.username} (cat) vs ${catcher.username} (catcher)`);
  
  while (moveCount < maxMoves) {
    const gameResult = board.getGameResult();
    if (gameResult.isOver) {
      console.log(`Game over: ${gameResult.winner} wins - ${gameResult.reason}`);
      break;
    }
    
    const currentUser = board.turn === Turn.Cat ? cat : catcher;
    const moveResult = await requestMove(board, currentUser);
    
    const moveReport = new MoveReport();
    moveReport.username = currentUser.username;
    moveReport.turn = board.turn;
    moveReport.time = moveResult.time;
    
    // Store the attempted move if available (will be undefined for timeouts)
    if (moveResult.move) {
      moveReport.move = moveResult.move;
    }
    
    if (moveResult.error || !moveResult.move) {
      // Player made an invalid move or timed out
      moveReport.error = moveResult.error || 'Invalid move';
      report.moves.push(moveReport);
      
      console.log(`${currentUser.username} (${board.turn}) failed: ${moveReport.error}`);
      
      // The other player wins
      if (board.turn === Turn.Cat) {
        report.catcherMoveScore = maxMoves - moveCount; // Catcher wins = higher score
        report.catMoveScore = moveCount; // Cat loses = lower score
      } else {
        report.catMoveScore = maxMoves - moveCount; // Cat wins = higher score
        report.catcherMoveScore = moveCount; // Catcher loses = lower score
      }
      break;
    }
    
    try {
      // Calculate time penalty before executing the move
      const timePenalty = calculateTimePenalty(moveResult.time);
      // Assign time penalty to the current player BEFORE the turn switches
      if (board.turn === Turn.Cat) {
        report.catTimeScore += timePenalty;
      } else {
        report.catcherTimeScore += timePenalty;
      }
      
      // Execute the move (board.move() will validate and throw error if invalid)
      board.move(moveResult.move);
      
      moveCount++;
      console.log(`${currentUser.username} (${moveReport.turn}) moved to (${moveResult.move.x}, ${moveResult.move.y}) in ${moveResult.time}ms`);
      
    } catch (error) {
      moveReport.error = error instanceof Error ? error.message : String(error);
      console.log(`${currentUser.username} (${board.turn}) made invalid move (${moveResult.move.x}, ${moveResult.move.y}): ${error instanceof Error ? error.message : String(error)}`);
      
      // Add the invalid move to the report before breaking
      report.moves.push(moveReport);
      
      // The other player wins
      if (board.turn === Turn.Cat) {
        report.catcherMoveScore = maxMoves - moveCount; // Catcher wins = higher score
        report.catMoveScore = moveCount; // Cat loses = lower score
      } else {
        report.catMoveScore = maxMoves - moveCount; // Cat wins = higher score
        report.catcherMoveScore = moveCount; // Catcher loses = lower score
      }
      break;
    }
    
    report.moves.push(moveReport);
  }
  
  // Final scoring if game ended normally
  const finalResult = board.getGameResult();
  if (finalResult.isOver && report.catMoveScore === 0 && report.catcherMoveScore === 0) {
    if (finalResult.winner === Turn.Cat) {
      report.catMoveScore = maxMoves - moveCount; // Cat wins = higher score
      report.catcherMoveScore = moveCount; // Catcher loses = lower score
    } else {
      report.catcherMoveScore = maxMoves - moveCount; // Catcher wins = higher score
      report.catMoveScore = moveCount; // Cat loses = lower score
    }
  }
  
  console.log(`Match completed: Cat score: ${report.catMoveScore}, Catcher score: ${report.catcherMoveScore}`);
  return report;
}

function calculateUserScores(matchReports: MatchReport[]): UserScore[] {
  const userScores = new Map<string, UserScore>();
  
  // Initialize user scores
  for (const user of users) {
    userScores.set(user.username, new UserScore(user.username));
  }
  
  // Accumulate scores from all matches
  for (const match of matchReports) {
    const catUser = userScores.get(match.cat)!;
    const catcherUser = userScores.get(match.catcher)!;
    
    // Normalize scores by board size
    const maxScore = match.initialState.board ? match.initialState.board.length : 441; // 21*21 default
    
    const normalizedCatMoveScore = match.catMoveScore / maxScore;
    const normalizedCatcherMoveScore = match.catcherMoveScore / maxScore;
    
    catUser.catMoveScore += normalizedCatMoveScore;
    catUser.catTimeScore += match.catTimeScore; // Time penalties already calculated progressively
    
    catcherUser.catcherMoveScore += normalizedCatcherMoveScore;
    catcherUser.catcherTimeScore += match.catcherTimeScore; // Time penalties already calculated progressively
    
    // Count wins based on move scores (higher move score = winner)
    if (match.catMoveScore > match.catcherMoveScore) {
      // Cat won this match
      catUser.catWins += 1;
    } else if (match.catcherMoveScore > match.catMoveScore) {
      // Catcher won this match
      catcherUser.catcherWins += 1;
    }
    // Note: ties are not counted as wins for either player
  }
  
  // Calculate final scores
  for (const userScore of Array.from(userScores.values())) {
    userScore.catScore = userScore.catMoveScore - userScore.catTimeScore;
    userScore.catcherScore = userScore.catcherMoveScore - userScore.catcherTimeScore;
    userScore.totalScore = userScore.catScore + userScore.catcherScore;
  }
  
  // Sort by total score (descending)
  return Array.from(userScores.values()).sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Compress board string using run-length encoding
 * Example: "...#.." becomes "3.1#2."
 */
function compressBoard(board: string): string {
  if (!board) return '';
  
  let compressed = '';
  let currentChar = board[0];
  let count = 1;
  
  for (let i = 1; i < board.length; i++) {
    if (board[i] === currentChar) {
      count++;
    } else {
      compressed += count > 1 ? count + currentChar : currentChar;
      currentChar = board[i];
      count = 1;
    }
  }
  
  // Add the last group
  compressed += count > 1 ? count + currentChar : currentChar;
  return compressed;
}

/**
 * Optimize the competition report to reduce JSON size
 */
function optimizeCompetitionReport(report: CompetitionReport): any {
  // Create username mapping
  const allUsernames = Array.from(new Set([
    ...report.matches.map(match => match.cat),
    ...report.matches.map(match => match.catcher),
    ...report.matches.flatMap(match => match.moves.map(move => move.username))
  ]));
  
  const userMap = new Map<string, number>();
  allUsernames.forEach((username, index) => {
    userMap.set(username, index);
  });

  // Optimize matches
  const optimizedMatches = report.matches.map(match => ({
    m: match.moves.map(move => ({
      u: userMap.get(move.username), // username index
      t: move.turn === Turn.Cat ? 0 : 1, // turn as number
      tm: move.time, // time
      ...(move.move && { mv: { x: move.move.x, y: move.move.y } }), // move (only if exists)
      ...(move.error && { e: move.error }) // error (only if exists)
    })),
    c: userMap.get(match.cat), // cat username index
    ch: userMap.get(match.catcher), // catcher username index
    cms: match.catMoveScore,
    chs: match.catcherMoveScore,
    cts: match.catTimeScore,
    chts: match.catcherTimeScore,
    init: {
      b: compressBoard(match.initialState.board), // compressed board
      cp: { x: match.initialState.catPosition.x, y: match.initialState.catPosition.y },
      t: match.initialState.turn === Turn.Cat ? 0 : 1
    }
  }));

  // Optimize high scores
  const optimizedHighScores = report.highScores.map(score => ({
    u: userMap.get(score.username),
    cms: score.catMoveScore,
    chs: score.catcherMoveScore,
    cts: score.catTimeScore,
    chts: score.catcherTimeScore,
    cs: score.catScore,
    chs2: score.catcherScore,
    ts: score.totalScore,
    cw: score.catWins,
    chw: score.catcherWins
  }));

  return {
    users: allUsernames, // username mapping
    matches: optimizedMatches,
    highScores: optimizedHighScores
  };
}

async function main() {
  // clone all users to folder repos
  console.log('#### Cloning repositories... ####');
  for (const user of users) {
    console.log(`Cloning ${user.username}...`);
    // if the folder repos/username does not exist, clone the repo
    if (!fs.existsSync(`repos/${user.username}`))
      execSync(`git clone ${user.repo} repos/${user.username}`, { stdio: 'inherit' });
    else // else pull the latest changes and reset any local changes
      execSync(`cd repos/${user.username} && git reset --hard && git pull`, { stdio: 'inherit' });
  }

  // Create shared deps folder if it doesn't exist
  const depsDir = path.resolve(process.cwd(), 'deps');
  if (!fs.existsSync(depsDir)) {
    fs.mkdirSync(depsDir, { recursive: true });
  }

  // Get optimal number of parallel jobs for compilation
  const parallelJobs = getOptimalParallelJobs();
  console.log(`Using ${parallelJobs} parallel jobs for compilation (detected ${os.cpus().length} CPU cores)`);

  console.log('#### Configuring projects... ####');
  // run cmake configure and build the executable target catchthecat
  for (const user of users) {
    console.log("Configuring " + user.username);
    try {
      execSync(`cd repos/${user.username} && cmake -B build -DCPM_SOURCE_CACHE=${depsDir}`, { stdio: 'inherit' });
    } catch (error) {
      console.log(`❌ Configuration failed for ${user.username}: ${error}`);
    }
  }

  console.log('#### Building projects... ####');
  for (const user of users) {
    console.log("Building " + user.username);
    try {
      execSync(`cd repos/${user.username} && cmake --build build --target catchthecat --parallel ${parallelJobs}`, { stdio: 'inherit' });
    } catch (error) {
      console.log(`❌ Build failed for ${user.username}: ${error}`);
    }
  }

  // leave only the users that have a valid compilation
  users = users.filter(user => fs.existsSync(`repos/${user.username}/build/bin/catchthecat`));

  console.log('#### Generating random boards... ####');
  // generate 4 random boards
  let initialStates: string[] = [];
  for (let i = 0; i < 4; i++) {
    let board = Board.generateRandomBoard(21);
    initialStates.push(board);
    console.log(`Generated board ${i + 1}/4`);
  }

  // run each user's catchthecat executable with the random boards
  console.log('#### Running catchthecat competition... ####');

  let matchReports: MatchReport[] = [];

  for (const initialState of initialStates) {
    for (const cat of users) {
      for (const catcher of users) {
        if (cat.username === catcher.username) continue;
        const matchReport = await runMatch(cat, catcher, initialState);
        matchReports.push(matchReport);
      }
    }
  }

  // Calculate user scores and generate report
  console.log('#### Calculating scores and generating report... ####');
  const userScores = calculateUserScores(matchReports);
  
  const competitionReport = new CompetitionReport();
  competitionReport.matches = matchReports;
  competitionReport.highScores = userScores;
  
  // Generate optimized JSON report for further analysis
  const optimizedReport = optimizeCompetitionReport(competitionReport);
  fs.writeFileSync('src/competition_report.json', JSON.stringify(optimizedReport));
  
  console.log('#### Competition completed! ####');
  console.log('Results saved to:');
  console.log('- src/competition_report.json (Machine-readable data for React)');
}

main().then(() => {
  console.log('done');
}).catch((error) => {
  console.error('Error running competition:', error);
  process.exit(1);
});
