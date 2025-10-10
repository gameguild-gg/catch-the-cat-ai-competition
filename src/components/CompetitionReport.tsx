import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { Input } from './ui/input';
import { CompetitionReport, MatchReport, Board, Position, Turn } from '../board';
import competitionReportData from '../competition_report.json';
import { BUILD_TIMESTAMP } from '../buildTimestamp';

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

// Cache for decompressed data to avoid reprocessing
let cachedDecompressedReport: CompetitionReport | null = null;

/**
 * Convert optimized competition report back to original format with performance optimizations
 */
function deoptimizeCompetitionReport(optimizedData: any): CompetitionReport {
  // Return cached result if available
  if (cachedDecompressedReport) {
    return cachedDecompressedReport;
  }
  const users = optimizedData.users || [];
  
  // Convert matches back to original format
  const matches = optimizedData.matches.map((match: any) => ({
    moves: match.m.map((move: any) => ({
      username: users[move.u],
      turn: move.t === 0 ? Turn.Cat : Turn.Catcher,
      time: move.tm,
      ...(move.mv && { move: { x: move.mv.x, y: move.mv.y } }),
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
    totalScore: score.ts,
    catWins: score.cw || 0,
    catcherWins: score.chw || 0
  }));

  const result = {
    matches,
    highScores
  };

  // Cache the result
  cachedDecompressedReport = result;
  return result;
}

interface CompetitionReportProps {
  reportData?: CompetitionReport;
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

// Function to determine the winner of a match
function getMatchWinner(match: MatchReport): { winner: 'cat' | 'catcher' | null; reason?: string } {
  try {
    // Reconstruct the final board state
    const finalState = reconstructBoardState(match, match.moves.length - 1);
    
    // Create a board instance to check game result
    const board = new Board(
      finalState.board,
      finalState.catPosition,
      match.cat,
      match.catcher
    );
    
    const gameResult = board.getGameResult();
    
    if (gameResult.isOver && gameResult.winner) {
      return {
        winner: gameResult.winner === Turn.Cat ? 'cat' : 'catcher',
        reason: gameResult.reason
      };
    }
    
    // If game is not over, determine winner by score
    const catFinalScore = match.catMoveScore - match.catTimeScore;
    const catcherFinalScore = match.catcherMoveScore - match.catcherTimeScore;
    
    if (catFinalScore > catcherFinalScore) {
      return { winner: 'cat', reason: 'Higher score' };
    } else if (catcherFinalScore > catFinalScore) {
      return { winner: 'catcher', reason: 'Higher score' };
    }
    
    return { winner: null, reason: 'Tie' };
  } catch (error) {
    // If there's an error, fall back to score comparison
    const catFinalScore = match.catMoveScore - match.catTimeScore;
    const catcherFinalScore = match.catcherMoveScore - match.catcherTimeScore;
    
    if (catFinalScore > catcherFinalScore) {
      return { winner: 'cat', reason: 'Higher score' };
    } else if (catcherFinalScore > catFinalScore) {
      return { winner: 'catcher', reason: 'Higher score' };
    }
    
    return { winner: null, reason: 'Tie' };
  }
}

// Hexagonal Board Component with proper SVG rendering
interface HexagonalBoardProps {
  boardString: string;
  catPosition: { x: number; y: number };
  side?: number;
}

function HexagonalBoard({ boardString, catPosition, side = 21 }: HexagonalBoardProps) {
  const sideSideOver2 = Math.floor(side / 2);
  const hexSize = 18; // Increased size of each hexagon
  const hexWidth = hexSize * Math.sqrt(3); // Width for flat-top hexagons
  const hexHeight = hexSize * 2; // Height for flat-top hexagons
  const vertSpacing = hexHeight * 0.75; // Vertical spacing between rows
  const horizSpacing = hexWidth; // Horizontal spacing between columns
  
  // Convert board string to 2D array for easier access
  const boardArray = boardString.split('');
  
  // Helper function to convert position to index
  const positionToIndex = (x: number, y: number): number => {
    return (y + sideSideOver2) * side + (x + sideSideOver2);
  };
  
  const catIndex = positionToIndex(catPosition.x, catPosition.y);
  
  // Generate hexagon path (rotated 60 degrees for flat-top orientation)
  const generateHexagonPath = (centerX: number, centerY: number, size: number): string => {
    const points = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + (Math.PI / 6); // Add π/6 (30°) to rotate by 60° total
      const x = centerX + size * Math.cos(angle);
      const y = centerY + size * Math.sin(angle);
      points.push(`${x},${y}`);
    }
    return `M ${points.join(' L ')} Z`;
  };
  
  // Calculate board dimensions
  const boardWidth = side * horizSpacing + horizSpacing * 0.5; // Add extra space for offset
  const boardHeight = side * vertSpacing + hexHeight;
  
  const hexagons = [];
  
  for (let y = -sideSideOver2; y <= sideSideOver2; y++) {
    for (let x = -sideSideOver2; x <= sideSideOver2; x++) {
      const index = positionToIndex(x, y);
      
      // Calculate hexagon position
      const offsetX = ((y % 2) + 2) % 2 === 1 ? horizSpacing * 0.5 : 0; // Offset for odd rows
      const centerX = (x + sideSideOver2) * horizSpacing + offsetX + hexWidth * 0.5;
      const centerY = (y + sideSideOver2) * vertSpacing + hexHeight * 0.5;
      
      // Determine cell type
      const isCat = index === catIndex;
      const isBlocked = index < boardArray.length && boardArray[index] === '#';
      const isEmpty = !isCat && !isBlocked;
      
      // Hexagon colors and styles
      let fillColor = '#a3e635'; // Light green for empty cells
      let strokeColor = '#65a30d'; // Darker green border
      let strokeWidth = 1;
      
      if (isBlocked) {
        fillColor = '#4b5563'; // Gray for blocked cells
        strokeColor = '#374151'; // Darker gray border
        strokeWidth = 2;
      }
      
      if (isCat) {
        fillColor = '#fef3c7'; // Light yellow for cat cell
        strokeColor = '#f59e0b'; // Orange border for cat
        strokeWidth = 3;
      }
      
      hexagons.push(
        <g key={`hex-${x}-${y}`} className="hexagon-cell group">
          <path
            d={generateHexagonPath(centerX, centerY, hexSize)}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            className={`transition-all duration-200 ${
              isEmpty ? 'hover:fill-green-300 hover:stroke-green-600 cursor-pointer' : ''
            } ${
              isBlocked ? 'hover:fill-gray-600' : ''
            } ${
              isCat ? 'hover:fill-yellow-200 animate-pulse' : ''
            }`}
          />
          {/* Content overlay */}
          {isCat && (
            <text
              x={centerX}
              y={centerY + 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="24"
              className="pointer-events-none select-none"
            >
              🐱
            </text>
          )}
          {isBlocked && (
            <text
              x={centerX}
              y={centerY + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="12"
              fill="white"
              fontWeight="bold"
              className="pointer-events-none select-none"
            >
              ✕
            </text>
          )}
        </g>
      );
    }
  }
  
  return (
    <div className="flex justify-center items-center p-4">
      <svg
        width={boardWidth}
        height={boardHeight}
        viewBox={`0 0 ${boardWidth} ${boardHeight}`}
        className="max-w-full h-auto border rounded-lg bg-gradient-to-br from-green-50 to-green-100 shadow-lg"
        style={{ minWidth: '300px', maxWidth: '800px' }}
      >
        {hexagons}
      </svg>
    </div>
  );
}

interface BoardViewerProps {
  match: MatchReport;
}

function BoardViewer({ match }: BoardViewerProps) {
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1); // -1 for initial state

  // Reset to initial state when match changes (e.g., when filters are cleared)
  useEffect(() => {
    setCurrentMoveIndex(-1);
  }, [match]);
  
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

  // Safety check: if currentState is undefined, reset to initial state
  if (!currentState) {
    setCurrentMoveIndex(-1);
    return null; // Return null to prevent rendering with invalid state
  }

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
                {currentState.moveInfo.username}: {currentState.moveInfo.move ? `(${currentState.moveInfo.move.x}, ${currentState.moveInfo.move.y})` : 'No move (timeout/error)'}
                {currentState.moveInfo.error && currentState.moveInfo.move && (
                  <span className="text-red-600 ml-2">- Invalid move</span>
                )}
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
      <div className="bg-muted rounded border overflow-x-auto">
        <HexagonalBoard 
          boardString={currentState.board} 
          catPosition={currentState.catPosition} 
        />
      </div>
    </div>
  );
}

export function CompetitionReportComponent({ reportData }: CompetitionReportProps) {
  const [report, setReport] = useState<CompetitionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isArchiveHovered, setIsArchiveHovered] = useState(false);
  
  // Enhanced filter state
  const [player1Filter, setPlayer1Filter] = useState('');
  const [player1AsCat, setPlayer1AsCat] = useState(true);
  const [player1AsCatcher, setPlayer1AsCatcher] = useState(true);
  
  const [player2Filter, setPlayer2Filter] = useState('');
  const [player2AsCat, setPlayer2AsCat] = useState(true);
  const [player2AsCatcher, setPlayer2AsCatcher] = useState(true);

  // Pagination state for matches
  const [currentPage, setCurrentPage] = useState(1);
  const matchesPerPage = 10; // Show only 10 matches at a time

  // Memoize expensive computations
  const sortedScores = useMemo(() => {
    if (!report) return [];
    return [...report.highScores].sort((a, b) => b.totalScore - a.totalScore);
  }, [report]);

  const allUsernames = useMemo(() => {
    if (!report) return [];
    return Array.from(new Set([
      ...report.matches.map(match => match.cat),
      ...report.matches.map(match => match.catcher)
    ])).sort();
  }, [report]);

  // Boards tested derived from matches and player count: NumberOfMatches/(NumOfPlayers*(NumOfPlayers-1))
  const boardsTested = useMemo(() => {
    if (!report) return 0;
    const numMatches = report.matches.length;
    const players = Array.from(new Set([
      ...report.matches.map(m => m.cat),
      ...report.matches.map(m => m.catcher)
    ])).length;
    if (players <= 1) return 0;
    return numMatches / (players * (players - 1));
  }, [report]);

  // Enhanced filter matches based on user selection and roles
  const filteredMatches = useMemo(() => {
    if (!report) return [];
    
    // Build a quick lookup for user total scores
    const userTotalScore: Record<string, number> = {};
    for (const s of report.highScores) {
      userTotalScore[s.username] = s.totalScore;
    }
    
    const base = report.matches.filter(match => {
      // If no players selected, show all matches
      if (player1Filter === '' && player2Filter === '') {
        return true;
      }
      
      // Check if player1 matches the filter criteria
      const player1Matches = player1Filter === '' || (
        (player1AsCat && match.cat === player1Filter) ||
        (player1AsCatcher && match.catcher === player1Filter)
      );
      
      // Check if player2 matches the filter criteria
      const player2Matches = player2Filter === '' || (
        (player2AsCat && match.cat === player2Filter) ||
        (player2AsCatcher && match.catcher === player2Filter)
      );
      
      // If only one player is selected, show matches where that player participates in the selected role(s)
      if (player1Filter !== '' && player2Filter === '') {
        return player1Matches;
      }
      
      if (player1Filter === '' && player2Filter !== '') {
        return player2Matches;
      }
      
      // If both players are selected, show matches where both players participate in their selected roles
      if (player1Filter !== '' && player2Filter !== '') {
        return player1Matches && player2Matches;
      }
      
      return false;
    });

    // Preserve order from backend (no client-side sorting/randomization)
    return base;
  }, [report, player1Filter, player1AsCat, player1AsCatcher, player2Filter, player2AsCat, player2AsCatcher]);



  // Paginated matches for performance
  const paginatedMatches = useMemo(() => {
    const startIndex = (currentPage - 1) * matchesPerPage;
    const endIndex = startIndex + matchesPerPage;
    return filteredMatches.slice(startIndex, endIndex);
  }, [filteredMatches, currentPage, matchesPerPage]);

  const totalPages = Math.ceil(filteredMatches.length / matchesPerPage);

  const loadReport = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Use setTimeout to make the processing async and show loading state
      setTimeout(() => {
        try {
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
          setLoading(false);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load report');
          setLoading(false);
        }
      }, 10); // Small delay to show loading state
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
      setLoading(false);
    }
  }, []);

  const handleWebArchive = useCallback(() => {
    const currentUrl = window.location.href;
    window.open(`https://archive.today/?run=1&url=${encodeURIComponent(currentUrl)}`, '_blank');
  }, []);

  useEffect(() => {
    if (!reportData) {
      loadReport();
    }
  }, [reportData, loadReport]);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [player1Filter, player1AsCat, player1AsCatcher, player2Filter, player2AsCat, player2AsCatcher]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <div className="text-lg font-medium">Loading competition results...</div>
          <div className="text-sm text-muted-foreground">Processing match data and decompressing boards</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">❌ Error Loading Report</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button onClick={loadReport} className="w-full">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <div className="text-lg font-medium">No report data available</div>
          <Button onClick={loadReport}>
            Load Report
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">🏆 Competition Results</CardTitle>
          <CardDescription>
            Competition results from the latest run
          </CardDescription>
          <div className="text-sm text-muted-foreground mt-2">
            📅 Generated: {new Date(BUILD_TIMESTAMP.buildTime).toLocaleString()}
          </div>
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
              <div className="text-2xl font-bold">{boardsTested}</div>
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
          variant="outline"
          className="w-full relative overflow-hidden group bg-gradient-to-r from-purple-50 to-blue-50 hover:from-purple-100 hover:to-blue-100 border-2 border-purple-200 hover:border-purple-300 transition-all duration-300 ease-out transform hover:scale-105 active:scale-95 hover:shadow-lg hover:shadow-purple-200/50 rounded-xl py-3"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-purple-400/20 to-blue-400/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          <div className="relative flex items-center justify-center gap-2 font-medium">
            <span className="text-xl group-hover:animate-bounce">📚</span>
            <span className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent group-hover:from-purple-700 group-hover:to-blue-700 transition-all duration-300">
              Archive This Page
            </span>
          </div>
          <div className="absolute inset-0 rounded-xl bg-white/20 opacity-0 group-active:opacity-100 transition-opacity duration-150"></div>
        </Button>
        {isArchiveHovered && (
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-3 px-4 py-3 bg-gradient-to-r from-purple-900 to-blue-900 text-white text-sm rounded-xl shadow-xl shadow-purple-500/25 z-10 whitespace-nowrap animate-in fade-in-0 zoom-in-95 duration-200">
            <div className="flex items-center gap-2">
              <span className="animate-pulse">✨</span>
              Create a permanent archive of this page
              <span className="animate-pulse">✨</span>
            </div>
            <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1 w-3 h-3 bg-gradient-to-br from-purple-900 to-blue-900 rotate-45"></div>
          </div>
        )}
      </div>

      {/* Leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle>🥇 Top 10 Leaderboard</CardTitle>
          <CardDescription>
            Top 8 players ranked by total score (normalized by board size with time penalties)
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
                  <TableHead className="text-right min-w-[80px]">Cat Wins</TableHead>
                  <TableHead className="text-right min-w-[100px]">Catcher Wins</TableHead>
                  <TableHead className="text-right min-w-[80px]">Cat Time</TableHead>
                  <TableHead className="text-right min-w-[100px]">Catcher Time</TableHead>
                </TableRow>
              </TableHeader>
            <TableBody>
              {sortedScores.slice(0, 10).map((score, index) => (
                <TableRow key={score.username}>
                  <TableCell className="font-medium">
                    {index === 0 ? (
                      <span className="text-yellow-500">🥇</span>
                    ) : index === 1 ? (
                      <span className="text-gray-400">🥈</span>
                    ) : index === 2 ? (
                      <span className="text-amber-600">🥉</span>
                    ) : (
                      <span>#{index + 1}</span>
                    )}
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
                  <TableCell className="text-right text-green-600 font-medium">
                    {score.catWins}
                  </TableCell>
                  <TableCell className="text-right text-green-600 font-medium">
                    {score.catcherWins}
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
            View detailed results from matches ({filteredMatches.length} of {report.matches.length} matches shown, page {currentPage} of {totalPages})
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Enhanced Filter Controls */}
          <div className="mb-6 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Player 1 Filter */}
              <div className="space-y-3 p-4 border rounded-lg">
                <h4 className="text-sm font-semibold text-gray-700">Player 1 Filter</h4>
                <div className="space-y-2">
                  <label htmlFor="player1-filter" className="text-sm font-medium">
                    Select User
                  </label>
                  <Select
                     id="player1-filter"
                     value={player1Filter}
                     onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPlayer1Filter(e.target.value)}
                     className="w-full"
                   >
                    <option value="">Any Player...</option>
                    {allUsernames.map(username => (
                      <option key={username} value={username}>{username}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Roles</label>
                  <div className="flex items-center space-x-4">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <Input
                        type="checkbox"
                        checked={player1AsCat}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPlayer1AsCat(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">🐱 Cat</span>
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <Input
                        type="checkbox"
                        checked={player1AsCatcher}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPlayer1AsCatcher(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">🕷️ Catcher</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Player 2 Filter */}
              <div className="space-y-3 p-4 border rounded-lg">
                <h4 className="text-sm font-semibold text-gray-700">Player 2 Filter</h4>
                <div className="space-y-2">
                  <label htmlFor="player2-filter" className="text-sm font-medium">
                    Select User
                  </label>
                  <Select
                     id="player2-filter"
                     value={player2Filter}
                     onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPlayer2Filter(e.target.value)}
                     className="w-full"
                   >
                    <option value="">Any Player...</option>
                    {allUsernames.map(username => (
                      <option key={username} value={username}>{username}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Roles</label>
                  <div className="flex items-center space-x-4">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <Input
                        type="checkbox"
                        checked={player2AsCat}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPlayer2AsCat(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">🐱 Cat</span>
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <Input
                        type="checkbox"
                        checked={player2AsCatcher}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPlayer2AsCatcher(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">🕷️ Catcher</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Filter Status and Clear Button */}
            {(player1Filter || player2Filter) && (
              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                <span className="text-sm text-blue-700">
                  {player1Filter && player2Filter 
                    ? `Showing matches with ${player1Filter} and ${player2Filter}: ${filteredMatches.length} matches`
                    : `Showing matches for ${player1Filter || player2Filter}: ${filteredMatches.length} of ${report.matches.length} matches`
                  }
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPlayer1Filter('');
                    setPlayer2Filter('');
                    setPlayer1AsCat(true);
                    setPlayer1AsCatcher(true);
                    setPlayer2AsCat(true);
                    setPlayer2AsCatcher(true);
                  }}
                >
                  Clear All Filters
                </Button>
              </div>
            )}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mb-6">
              <div className="text-sm text-muted-foreground">
                Showing {((currentPage - 1) * matchesPerPage) + 1} to {Math.min(currentPage * matchesPerPage, filteredMatches.length)} of {filteredMatches.length} matches
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <span className="text-sm">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {paginatedMatches.map((match, index) => {
              const globalIndex = (currentPage - 1) * matchesPerPage + index;
              const matchResult = getMatchWinner(match);
              
              return (
                <Card key={globalIndex} className="border-l-4 border-l-primary">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-lg">
                          Match {globalIndex + 1}: 
                          <div className="inline-flex items-center gap-2 ml-2">
                            <div className={`px-2 py-1 rounded text-sm font-medium ${
                              matchResult.winner === 'cat' ? 'bg-green-100 text-green-800' : 
                              matchResult.winner === 'catcher' ? 'bg-red-100 text-red-800' : 
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {match.cat}
                            </div>
                            <span className="text-gray-500">vs</span>
                            <div className={`px-2 py-1 rounded text-sm font-medium ${
                              matchResult.winner === 'catcher' ? 'bg-green-100 text-green-800' : 
                              matchResult.winner === 'cat' ? 'bg-red-100 text-red-800' : 
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {match.catcher}
                            </div>
                          </div>
                        </CardTitle>
                        <CardDescription>
                          Cat: <span className={matchResult.winner === 'cat' ? 'text-green-600 font-medium' : matchResult.winner === 'catcher' ? 'text-red-600' : 'text-gray-600'}>{match.cat}</span> • 
                          Catcher: <span className={matchResult.winner === 'catcher' ? 'text-green-600 font-medium' : matchResult.winner === 'cat' ? 'text-red-600' : 'text-gray-600'}>{match.catcher}</span>
                          {matchResult.winner && (
                            <span className="ml-2 text-xs text-gray-500">
                              ({matchResult.winner === 'cat' ? match.cat : match.catcher} won - {matchResult.reason})
                            </span>
                          )}
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
                            <div className="mt-2 space-y-1">
                              {match.moves
                                .filter(move => move.error)
                                .map((move, index) => (
                                  <div key={index} className="text-xs bg-red-50 border border-red-200 rounded p-2">
                                    <div className="font-medium text-red-800">
                                      Move {match.moves.indexOf(move) + 1} - {move.turn === Turn.Cat ? match.cat : match.catcher}:
                                    </div>
                                    <div className="text-red-700 mt-1 break-words whitespace-pre-wrap">
                                      {move.error}
                                      {move.move && (
                                        <div className="font-mono mt-1">
                                          at ({move.move.x}, {move.move.y})
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                      
                      {/* Interactive Board Viewer */}
                      {match.initialState?.board && (
                        <BoardViewer 
                          key={`${match.cat}-${match.catcher}-${player1Filter}-${player2Filter}`}
                          match={match} 
                        />
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}