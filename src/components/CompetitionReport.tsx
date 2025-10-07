import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { CompetitionReport, MatchReport, Board, Position, Turn } from '../board';
import competitionReportData from '../competition_report.json';

/**
 * Decompress board string from run-length encoding
 * Example: "3.1#2." becomes "...#.."
 */
function decompressBoard(compressed: string): string {
  if (!compressed) return '';
  
  let decompressed = '';
  let i = 0;
  
  while (i < compressed.length) {
    let count = '';
    
    // Read digits for count
    while (i < compressed.length && /\d/.test(compressed[i])) {
      count += compressed[i];
      i++;
    }
    
    // If no count was found, default to 1
    const repeatCount = count ? parseInt(count) : 1;
    
    // Get the character to repeat
    if (i < compressed.length) {
      const char = compressed[i];
      decompressed += char.repeat(repeatCount);
      i++;
    }
  }
  
  return decompressed;
}

/**
 * Convert optimized competition report back to original format
 */
function deoptimizeCompetitionReport(optimizedData: any): CompetitionReport {
  const users = optimizedData.users || [];
  
  // Convert matches back to original format
  const matches = optimizedData.matches.map((match: any) => ({
    moves: match.m.map((move: any) => ({
      username: users[move.u],
      turn: move.t === 0 ? Turn.Cat : Turn.Catcher,
      time: move.tm,
      move: { x: move.mv.x, y: move.mv.y },
      ...(move.e && { error: move.e })
    })),
    cat: users[match.c],
    catcher: users[match.ch],
    catMoveScore: match.cms,
    catcherMoveScore: match.chs,
    catTimeScore: match.cts,
    catcherTimeScore: match.chts,
    initialState: {
      board: decompressBoard(match.init.b),
      catPosition: { x: match.init.cp.x, y: match.init.cp.y },
      turn: match.init.t === 0 ? Turn.Cat : Turn.Catcher
    }
  }));

  // Convert high scores back to original format
  const highScores = optimizedData.highScores.map((score: any) => ({
    username: users[score.u],
    catMoveScore: score.cms,
    catcherMoveScore: score.chs,
    catTimeScore: score.cts,
    catcherTimeScore: score.chts,
    catScore: score.cs,
    catcherScore: score.chs2,
    totalScore: score.ts
  }));

  return {
    matches,
    highScores
  };
}

interface CompetitionReportProps {
  reportData?: CompetitionReport;
}

// Helper function to format board in hexagonal layout
function formatHexagonalBoard(boardString: string, catPosition: { x: number; y: number }, side: number = 21): string {
  let formattedBoard = '';
  const sideSideOver2 = Math.floor(side / 2);
  
  // Convert board string to 2D array for easier access
  const boardArray = boardString.split('');
  
  // Helper function to convert position to index (similar to Board class)
  const positionToIndex = (x: number, y: number): number => {
    return (y + sideSideOver2) * side + (x + sideSideOver2);
  };
  
  const catIndex = positionToIndex(catPosition.x, catPosition.y);
  
  for (let y = -sideSideOver2; y <= sideSideOver2; y++) {
    for (let x = -sideSideOver2; x <= sideSideOver2; x++) {
      const index = positionToIndex(x, y);
      
      // Add space at the beginning of odd lines (for hexagonal offset)
      // Handle negative modulo correctly: in JS, -1 % 2 = -1, but we want it to be 1
      if (((y % 2) + 2) % 2 === 1 && x === -sideSideOver2) {
        formattedBoard += ' ';
      }
      
      // Add the cell content (cat, blocked, or empty)
      if (index === catIndex) {
        formattedBoard += '<span class="text-red-600 font-bold">C</span>';
      } else if (index < boardArray.length) {
        formattedBoard += boardArray[index] === '#' ? '<span class="font-bold">#</span>' : '.';
      } else {
        formattedBoard += '.';
      }
      
      // Add space between cells or newline at end of row
      if (x === sideSideOver2) {
        formattedBoard += '\n';
      } else {
        formattedBoard += ' ';
      }
    }
  }
  
  return formattedBoard;
}

// Function to reconstruct board state at a specific move index
function reconstructBoardState(match: MatchReport, moveIndex: number): { board: string; catPosition: Position } {
  // Start with initial state
  const board = new Board(
    match.initialState.board,
    new Position(match.initialState.catPosition.x, match.initialState.catPosition.y),
    match.cat,
    match.catcher
  );
  
  // Apply moves up to the specified index
  for (let i = 0; i <= moveIndex && i < match.moves.length; i++) {
    const move = match.moves[i];
    if (move.move && !move.error) {
      try {
        board.move(new Position(move.move.x, move.move.y));
      } catch (error) {
        // If move fails, stop here
        break;
      }
    }
  }
  
  return {
    board: board.getBoardString(),
    catPosition: board.catPosition
  };
}

interface BoardViewerProps {
  match: MatchReport;
}

function BoardViewer({ match }: BoardViewerProps) {
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1); // -1 for initial state
  
  // Create array of all board states (initial + after each move)
  const boardStates = [
    {
      board: match.initialState.board,
      catPosition: match.initialState.catPosition,
      turn: match.initialState.turn,
      moveInfo: null,
      isInitial: true
    },
    ...match.moves.map((move, index) => {
      const reconstructed = reconstructBoardState(match, index);
      return {
        board: reconstructed.board,
        catPosition: reconstructed.catPosition,
        turn: move.turn,
        moveInfo: move,
        isInitial: false,
        moveNumber: index + 1
      };
    })
  ];

  const currentState = boardStates[currentMoveIndex + 1]; // +1 because -1 index maps to 0
  const canGoPrevious = currentMoveIndex > -1;
  const canGoNext = currentMoveIndex < match.moves.length - 1;

  const goToPrevious = () => {
    if (canGoPrevious) {
      setCurrentMoveIndex(currentMoveIndex - 1);
    }
  };

  const goToNext = () => {
    if (canGoNext) {
      setCurrentMoveIndex(currentMoveIndex + 1);
    }
  };

  return (
    <div className="space-y-4">
      {/* Board State Info */}
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <div className="text-sm font-medium">
             {currentState.isInitial ? (
               <span>Initial Board State</span>
             ) : (
               <span>After Move {(currentState as any).moveNumber}</span>
             )}
           </div>
          {currentState.moveInfo && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={currentState.turn === 'cat' ? 'default' : 'secondary'}>
                {currentState.turn}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {currentState.moveInfo.username}: ({currentState.moveInfo.move.x}, {currentState.moveInfo.move.y})
              </span>
              <span className="text-xs text-muted-foreground">
                {currentState.moveInfo.time}ms
              </span>
            </div>
          )}
          {currentState.isInitial && (
            <div className="text-sm text-muted-foreground">
              First turn: {currentState.turn}, Cat at: ({currentState.catPosition.x}, {currentState.catPosition.y})
            </div>
          )}
        </div>
        
        {/* Navigation Controls */}
        <div className="flex items-center justify-center gap-2 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={goToPrevious}
            disabled={!canGoPrevious}
            className="flex-shrink-0"
          >
            ← Previous
          </Button>
          <span className="text-sm text-muted-foreground whitespace-nowrap px-2 font-mono">
            {currentMoveIndex + 2} / {boardStates.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={goToNext}
            disabled={!canGoNext}
            className="flex-shrink-0"
          >
            Next →
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {currentState.moveInfo?.error && (
        <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
          Error: {currentState.moveInfo.error}
        </div>
      )}

      {/* Board Display */}
      <div className="bg-muted p-2 sm:p-4 rounded border overflow-x-auto">
        <pre 
          className="text-xs font-mono whitespace-pre text-center min-w-fit"
          style={{ fontSize: 'clamp(8px, 2vw, 10px)', lineHeight: '1.2' }}
          dangerouslySetInnerHTML={{
            __html: formatHexagonalBoard(currentState.board, currentState.catPosition)
          }}
        ></pre>
      </div>
    </div>
  );
}

export function CompetitionReportComponent({ reportData }: CompetitionReportProps) {
  const [report, setReport] = useState<CompetitionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isArchiveHovered, setIsArchiveHovered] = useState(false);
  
  // Filter state
  const [username1Filter, setUsername1Filter] = useState('');
  const [username2Filter, setUsername2Filter] = useState('');

  useEffect(() => {
    if (!reportData) {
      loadReport();
    }
  }, [reportData]);

  const loadReport = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Check if the data is in optimized format (has 'users' array)
      const rawData = competitionReportData as any;
      if (rawData.users && Array.isArray(rawData.users)) {
        // Decompress optimized format
        const decompressedReport = deoptimizeCompetitionReport(rawData);
        setReport(decompressedReport);
      } else {
        // Data is already in original format
        setReport(rawData as CompetitionReport);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading competition report...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Error Loading Report</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={loadReport} variant="outline">
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Report Available</CardTitle>
          <CardDescription>
            Run the competition to generate a report
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const sortedScores = [...report.highScores].sort((a, b) => b.totalScore - a.totalScore);

  // Extract unique usernames from all matches
  const allUsernames = Array.from(new Set([
    ...report.matches.map(match => match.cat),
    ...report.matches.map(match => match.catcher)
  ])).sort();

  // Filter matches based on two usernames
  const filteredMatches = report.matches.filter(match => {
    // If no usernames selected, show all matches
    if (username1Filter === '' && username2Filter === '') {
      return true;
    }
    
    // If only one username selected, show matches involving that username
    if (username1Filter !== '' && username2Filter === '') {
      return match.cat === username1Filter || match.catcher === username1Filter;
    }
    
    if (username1Filter === '' && username2Filter !== '') {
      return match.cat === username2Filter || match.catcher === username2Filter;
    }
    
    // If both usernames selected, show matches between them
    if (username1Filter !== '' && username2Filter !== '') {
      return (match.cat === username1Filter && match.catcher === username2Filter) ||
             (match.cat === username2Filter && match.catcher === username1Filter);
    }
    
    return false;
  });

  const handleWebArchive = () => {
    const currentUrl = window.location.href;
    const archiveUrl = `https://archive.today/?run=1&url=${encodeURIComponent(currentUrl)}`;
    
    // Show a brief confirmation
    const originalTitle = document.title;
    document.title = "📸 Archiving to Archive.today...";
    
    // Open the archive URL
    window.open(archiveUrl, '_blank');
    
    // Restore title after a moment
    setTimeout(() => {
      document.title = originalTitle;
    }, 3000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">🏆 Competition Results</CardTitle>
          <CardDescription>
            Competition results from the latest run
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold">{report.highScores.length}</div>
              <div className="text-sm text-muted-foreground">Participants</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{report.matches.length}</div>
              <div className="text-sm text-muted-foreground">Total Matches</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{report.matches.length / (report.highScores.length * (report.highScores.length - 1))}</div>
              <div className="text-sm text-muted-foreground">Boards Tested</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Web Archive Button */}
      <div className="relative">
        <Button 
          onClick={handleWebArchive}
          onMouseEnter={() => setIsArchiveHovered(true)}
          onMouseLeave={() => setIsArchiveHovered(false)}
          className="w-full h-16 text-lg font-semibold bg-gradient-to-r from-purple-600 via-blue-600 to-indigo-600 hover:from-purple-700 hover:via-blue-700 hover:to-indigo-700 text-white border-0 shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-300 ease-out relative overflow-hidden group"
        >
          {/* Shine effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out"></div>
          
          {/* Button content */}
          <div className="relative z-10 flex items-center justify-center gap-3">
            <span className="text-2xl">📸</span>
            <span>Archive to Archive.today</span>
            <span className="text-xl">✨</span>
          </div>
        </Button>
        
        {/* Hover message */}
        {isArchiveHovered && (
          <div className="absolute -top-16 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm whitespace-nowrap z-20 animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
            <div className="text-center">
              <div className="font-semibold">📸 Capture this page perfectly!</div>
              <div className="text-gray-300">Archive.today preserves React apps better than Wayback Machine</div>
            </div>
            {/* Arrow */}
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
          </div>
        )}
      </div>

      {/* Leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle>🥇 Top 3 Leaderboard</CardTitle>
          <CardDescription>
            Top 3 players ranked by total score (normalized by board size with time penalties)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Rank</TableHead>
                  <TableHead className="min-w-[120px]">Player</TableHead>
                  <TableHead className="text-right min-w-[100px]">Total Score</TableHead>
                  <TableHead className="text-right min-w-[90px]">Cat Score</TableHead>
                  <TableHead className="text-right min-w-[100px]">Catcher Score</TableHead>
                  <TableHead className="text-right min-w-[80px]">Cat Time</TableHead>
                  <TableHead className="text-right min-w-[100px]">Catcher Time</TableHead>
                </TableRow>
              </TableHeader>
            <TableBody>
              {sortedScores.slice(0, 3).map((score, index) => (
                <TableRow key={score.username}>
                  <TableCell className="font-medium">
                    {index === 0 && <span className="text-yellow-500">🥇</span>}
                    {index === 1 && <span className="text-gray-400">🥈</span>}
                    {index === 2 && <span className="text-amber-600">🥉</span>}
                    {index > 2 && <span className="text-muted-foreground">#{index + 1}</span>}
                  </TableCell>
                  <TableCell className="font-medium">{score.username}</TableCell>
                  <TableCell className="text-right font-bold">
                    {score.totalScore.toFixed(3)}
                  </TableCell>
                  <TableCell className="text-right">
                    {score.catScore.toFixed(3)}
                  </TableCell>
                  <TableCell className="text-right">
                    {score.catcherScore.toFixed(3)}
                  </TableCell>
                  <TableCell className="text-right text-destructive">
                    -{score.catTimeScore.toPrecision(3)}
                  </TableCell>
                  <TableCell className="text-right text-destructive">
                    -{score.catcherTimeScore.toPrecision(3)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      {/* Match Details */}
      <Card>
        <CardHeader>
          <CardTitle>📊 Match Details</CardTitle>
          <CardDescription>
            View detailed results from all matches ({filteredMatches.length} of {report.matches.length} matches shown)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filter Controls */}
          <div className="mb-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="username1-filter" className="text-sm font-medium">
                  Player 1
                </label>
                <Select
                   id="username1-filter"
                   value={username1Filter}
                   onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setUsername1Filter(e.target.value)}
                   className="w-full"
                 >
                  <option value="">Select Player 1...</option>
                  {allUsernames.map(username => (
                    <option key={username} value={username}>{username}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <label htmlFor="username2-filter" className="text-sm font-medium">
                  Player 2
                </label>
                <Select
                   id="username2-filter"
                   value={username2Filter}
                   onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setUsername2Filter(e.target.value)}
                   className="w-full"
                 >
                  <option value="">Select Player 2...</option>
                  {allUsernames.map(username => (
                    <option key={username} value={username}>{username}</option>
                  ))}
                </Select>
              </div>
            </div>
            {(username1Filter || username2Filter) && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {username1Filter && username2Filter 
                    ? `Showing matches between ${username1Filter} and ${username2Filter}: ${filteredMatches.length} matches`
                    : `Showing matches for ${username1Filter || username2Filter}: ${filteredMatches.length} of ${report.matches.length} matches`
                  }
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setUsername1Filter('');
                    setUsername2Filter('');
                  }}
                >
                  Clear Filters
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {filteredMatches.map((match, index) => (
                <Card key={index} className="border-l-4 border-l-primary">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-lg">
                          Match {index + 1}: {match.cat} vs {match.catcher}
                        </CardTitle>
                        <CardDescription>
                          Cat: {match.cat} • Catcher: {match.catcher}
                        </CardDescription>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium">
                          Cat: {match.catMoveScore} • Catcher: {match.catcherMoveScore}
                        </div>
                        {(match.catTimeScore > 0 || match.catcherTimeScore > 0) && (
                          <div className="text-xs text-destructive">
                            Time penalties:<br />
                            Cat -{match.catTimeScore.toPrecision(3)} • Catcher -{match.catcherTimeScore.toPrecision(3)}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="text-sm">
                        <strong>Moves played:</strong> {match.moves.length}
                        {match.moves.some(move => move.error) && (
                          <div className="mt-2">
                            <Badge variant="destructive" className="mr-2">
                              Errors Occurred
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              Some moves failed during execution
                            </span>
                          </div>
                        )}
                      </div>
                      
                      {/* Interactive Board Viewer */}
                      {match.initialState?.board && (
                        <BoardViewer match={match} />
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
        </CardContent>
      </Card>
    </div>
  );
}