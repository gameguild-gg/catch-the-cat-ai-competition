import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { CompetitionReport, MatchReport } from '../board';

interface CompetitionReportProps {
  reportData?: CompetitionReport;
}

// Helper function to find cat position from board string
function findCatPositionFromBoard(boardString: string, side: number = 21): { x: number; y: number } {
  const sideSideOver2 = Math.floor(side / 2);
  
  // Helper function to convert index to position
  const indexToPosition = (index: number): { x: number; y: number } => {
    const y = Math.floor(index / side) - sideSideOver2;
    const x = (index % side) - sideSideOver2;
    return { x, y };
  };
  
  // Find 'C' in the board string
  const catIndex = boardString.indexOf('C');
  if (catIndex !== -1) {
    return indexToPosition(catIndex);
  }
  
  // If no 'C' found, return center position as fallback
  return { x: 0, y: 0 };
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
    ...match.moves.map((move, index) => ({
      board: move.board,
      catPosition: findCatPositionFromBoard(move.board),
      turn: move.turn,
      moveInfo: move,
      isInitial: false,
      moveNumber: index + 1
    }))
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
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <div className="text-sm font-medium">
             {currentState.isInitial ? (
               <span>Initial Board State</span>
             ) : (
               <span>After Move {(currentState as any).moveNumber}</span>
             )}
           </div>
          {currentState.moveInfo && (
            <div className="flex items-center space-x-2">
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
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={goToPrevious}
            disabled={!canGoPrevious}
          >
            ← Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            {currentMoveIndex + 2} / {boardStates.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={goToNext}
            disabled={!canGoNext}
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
      <div className="bg-muted p-4 rounded border">
        <pre 
          className="text-xs font-mono whitespace-pre text-center"
          style={{ fontSize: '10px', lineHeight: '1.2' }}
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
  const [showMatches, setShowMatches] = useState(false);

  useEffect(() => {
    if (!reportData) {
      loadReport();
    }
  }, [reportData]);

  const loadReport = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/competition_report.json');
      if (!response.ok) {
        throw new Error('Failed to load competition report');
      }
      const data = await response.json();
      setReport(data);
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

      {/* Leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle>🥇 Final Leaderboard</CardTitle>
          <CardDescription>
            Ranked by total score (normalized by board size with time penalties)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Rank</TableHead>
                <TableHead>Player</TableHead>
                <TableHead className="text-right">Total Score</TableHead>
                <TableHead className="text-right">Cat Score</TableHead>
                <TableHead className="text-right">Catcher Score</TableHead>
                <TableHead className="text-right">Cat Time</TableHead>
                <TableHead className="text-right">Catcher Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedScores.map((score, index) => (
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
                    -{score.catTimeScore.toFixed(3)}
                  </TableCell>
                  <TableCell className="text-right text-destructive">
                    -{score.catcherTimeScore.toFixed(3)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Match Details Toggle */}
      <Card>
        <CardHeader>
          <CardTitle>📊 Match Details</CardTitle>
          <CardDescription>
            View detailed results from all matches
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={() => setShowMatches(!showMatches)}
            variant="outline"
            className="mb-4"
          >
            {showMatches ? 'Hide' : 'Show'} Match Details
          </Button>

          {showMatches && (
            <div className="space-y-4">
              {report.matches.map((match, index) => (
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
                            Time penalties: Cat -{match.catTimeScore} • Catcher -{match.catcherTimeScore}
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}