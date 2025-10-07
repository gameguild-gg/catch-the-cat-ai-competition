// board representation
// 0,0 is always at the center
// the line 0 is always aligned to the left,
// the first and last line are always aligned to the left
// the possible side sizes are 4*i+1, where i is an integer
/*
 /  \ /  \ /  \ /  \ /  \
|-2-2|-1-2| 0-2| 1-2| 2-2|
 \  / \  / \  / \  / \  / \
  |-2-1|-1-1| 0-1| 1-1| 2-1|
 /  \ /  \ /  \ /  \ /  \ /
|-2 0|-1 0| 0 0| 1 0| 2 0|
 \  / \  / \  / \  / \  / \
  |-2 1|-1 1| 0 1| 1 1| 2 1|
 /  \ /  \ /  \ /  \ /  \ /
|-2 2|-1 2| 0 2| 1 2| 2 2|
 \  / \  / \  / \  / \  /
*/

/*
 * Simple 5 x 5 board example
. . . . .
 # C . . .
. . . # .
 . . . . .
. . . . .
 */

export enum Turn {
  Cat = 'cat',
  Catcher = 'catcher',
}

export class InitialState {
  board: string = '';
  catPosition: Position = new Position();
  turn: Turn = Turn.Cat;
}

export class MatchReport {
  moves: MoveReport[] = [];
  cat: string = ''; // username
  catcher: string = ''; // username
  catMoveScore: number = 0;
  catcherMoveScore: number = 0;
  catTimeScore: number = 0;
  catcherTimeScore: number = 0;
  initialState: InitialState = new InitialState();
}

export class UserScore {
  constructor(
    public username: string,
    public catMoveScore: number = 0,
    public catcherMoveScore: number = 0,
    public catTimeScore: number = 0,
    public catcherTimeScore: number = 0,
    public catScore: number = 0, // catScore = catMoveScore - catTimeScore
    public catcherScore: number = 0, // catcherScore = catcherMoveScore - catcherTimeScore
    public totalScore: number = 0 // totalScore = catScore + catcherScore
  ) {}
}

export class CompetitionReport {
  matches: MatchReport[] = [];
  highScores: UserScore[] = [];
}

export class Position {
  constructor(public x: number = 0, public y: number = 0) {}
  
  equals(other: Position): boolean {
    return this.x === other.x && this.y === other.y;
  }
}

export class MoveReport {
  username: string = ''; // username of the player who made the move
  turn: Turn = Turn.Cat; // which player made the move
  time: number = 0; // how much time the agent spent on the move, in milliseconds
  move: Position = new Position(); // move applied by the agent cat or catcher
  error?: string; // error message if any
}

export class Board {
  side: number=0;
  turn: Turn = Turn.Cat;
  // . is empty, # is the catcher
  board: string = '';
  // position of the cat, for easy access
  catPosition: Position = new Position();
  catUsername: string = '';
  catcherUsername: string = '';

  constructor(board: string, catPosition: Position, catUsername: string, catcherUsername: string) {
    // remove all empty characters. Convert 'C' to '.' if present
    board = board.replace(/\s+/g, '').replace('C', '.');
    this.board = board;
    this.catPosition = catPosition;
    this.catUsername = catUsername;
    this.catcherUsername = catcherUsername;
    
    // Calculate side from board length (side * side = board.length)
    this.side = Math.sqrt(board.length);
    if (this.side % 1 !== 0) {
      throw new Error('Invalid board: length must be a perfect square');
    }
    
    // Validate that side follows the 4*i+1 pattern
    if ((this.side - 1) % 4 !== 0) {
      throw new Error('The side size must be 4*i+1, where i is an integer');
    }
  }

  // Hexagonal coordinate system helper functions
  // Based on the World.cpp implementation
  private E(p: Position): Position { return new Position(p.x + 1, p.y); }
  private W(p: Position): Position { return new Position(p.x - 1, p.y); }
  
  private NE(p: Position): Position {
    if (p.y % 2) return new Position(p.x + 1, p.y - 1);
    return new Position(p.x, p.y - 1);
  }
  
  private NW(p: Position): Position {
    if (p.y % 2) return new Position(p.x, p.y - 1);
    return new Position(p.x - 1, p.y - 1);
  }
  
  private SE(p: Position): Position {
    if (p.y % 2) return new Position(p.x, p.y + 1);
    return new Position(p.x - 1, p.y + 1);
  }
  
  private SW(p: Position): Position {
    if (p.y % 2) return new Position(p.x + 1, p.y + 1);
    return new Position(p.x, p.y + 1);
  }

  private isValidPosition(p: Position): boolean {
    const sideOver2 = Math.floor(this.side / 2);
    return (p.x >= -sideOver2) && (p.x <= sideOver2) && (p.y <= sideOver2) && (p.y >= -sideOver2);
  }

  private isNeighbor(p1: Position, p2: Position): boolean {
    const neighbors = [this.NE(p1), this.NW(p1), this.E(p1), this.W(p1), this.SE(p1), this.SW(p1)];
    return neighbors.some(neighbor => neighbor.equals(p2));
  }

  private positionToIndex(p: Position): number {
    return (p.y + Math.floor(this.side / 2)) * this.side + p.x + Math.floor(this.side / 2);
  }

  indexToPosition(index: number): Position {
    const sideOver2 = Math.floor(this.side / 2);
    const y = Math.floor(index / this.side) - sideOver2;
    const x = (index % this.side) - sideOver2;
    return new Position(x, y);
  }

  private getContent(p: Position): boolean {
    if (!this.isValidPosition(p)) return true; // out of bounds is blocked
    const index = this.positionToIndex(p);
    return this.board[index] === '#';
  }

  private setContent(p: Position, blocked: boolean): void {
    if (!this.isValidPosition(p)) return;
    const index = this.positionToIndex(p);
    const boardArray = this.board.split('');
    boardArray[index] = blocked ? '#' : '.';
    this.board = boardArray.join('');
  }

  // function to generate a random board of size side N.
  static generateRandomBoard(side: number): string {
    const totalCells = side * side;
    const board = new Array(totalCells).fill('.');
    
    // Place random obstacles (about 5% of the board)
    const obstacleCount = Math.floor(totalCells * 0.05 + Math.random() * totalCells * 0.05);
    for (let i = 0; i < obstacleCount; i++) {
      let randomIndex;
      do {
        randomIndex = Math.floor(Math.random() * totalCells);
      } while (randomIndex === Math.floor(totalCells / 2) || board[randomIndex] === '#');
      board[randomIndex] = '#';
    }
    
    // Cat position will be at center (0, 0) by default
    
    return board.join('');
  }

  // Check if cat wins by reaching the edge
  private catWinVerification(): boolean {
    const sideOver2 = Math.floor(this.side / 2);
    return Math.abs(this.catPosition.x) === sideOver2 || Math.abs(this.catPosition.y) === sideOver2;
  }

  // Check if catcher wins by surrounding the cat
  private catcherWinVerification(): boolean {
    const neighbors = [
      this.NE(this.catPosition),
      this.NW(this.catPosition),
      this.E(this.catPosition),
      this.W(this.catPosition),
      this.SE(this.catPosition),
      this.SW(this.catPosition)
    ];
    
    return neighbors.every(neighbor => this.getContent(neighbor));
  }

  private catCanMoveToPosition(p: Position): boolean {
    return this.isNeighbor(this.catPosition, p) && !this.getContent(p);
  }

  private catcherCanMoveToPosition(p: Position): boolean {
    const sideOver2 = Math.floor(this.side / 2);
    return !p.equals(this.catPosition) && 
           Math.abs(p.x) <= sideOver2 && 
           Math.abs(p.y) <= sideOver2 &&
           !this.getContent(p);
  }

  // Parse move string to Position (format: "x,y")
  private parseMove(move: string): Position {
    const parts = move.trim().split(',');
    if (parts.length !== 2) {
      throw new Error(`Invalid move format: ${move}. Expected format: "x,y"`);
    }
    
    const x = parseInt(parts[0]);
    const y = parseInt(parts[1]);
    
    if (isNaN(x) || isNaN(y)) {
      throw new Error(`Invalid move coordinates: ${move}. Coordinates must be numbers`);
    }
    
    return new Position(x, y);
  }

  // validate move for the current turn
  validateMove(position: Position): boolean {
    if (this.turn === Turn.Cat) {
      return this.catCanMoveToPosition(position);
    } else {
      return this.catcherCanMoveToPosition(position);
    }
  }

  // Convenience method for string-based validation (backward compatibility)
  validateMoveString(move: string): boolean {
    try {
      const position = this.parseMove(move);
      return this.validateMove(position);
    } catch (error) {
      return false;
    }
  }

  // Execute a move
  move(position: Position): void {
    if (!this.validateMove(position)) {
      throw new Error(`Invalid move: (${position.x},${position.y}) for ${this.turn}`);
    }

    if (this.turn === Turn.Cat) {
      this.catPosition = position;
    } else {
      this.setContent(position, true);
    }

    // Switch turns
    this.turn = this.turn === Turn.Cat ? Turn.Catcher : Turn.Cat;
  }

  // Convenience method for string-based moves (backward compatibility)
  moveString(move: string): void {
    const position = this.parseMove(move);
    this.move(position);
  }

  // Get current board state as string with cat position marked
  getBoardString(): string {
    const boardArray = this.board.split('');
    const catIndex = this.positionToIndex(this.catPosition);
    boardArray[catIndex] = 'C';
    return boardArray.join('');
  }

  // pretty print the board with cat
  prettyPrintBoard(): string {
    let boardString = '';
    let catIndex = this.positionToIndex(this.catPosition);
    // sideSideOver2 is the integer division of side / 2
    let sideSideOver2 = Math.floor(this.side / 2);

    for(let y=-sideSideOver2; y<=sideSideOver2; y++) {
      for(let x=-sideSideOver2; x<=sideSideOver2; x++) {
        let pos = new Position(x, y);
        let index = this.positionToIndex(pos);
        // odd lines starts with 1 space
        if(y%2===1 && x === -sideSideOver2)
          boardString += ' ';
        boardString += (index === catIndex) ? 'C' : (this.getContent(pos) ? '#' : '.');
        if (x === sideSideOver2) {
          boardString += '\n';
        } else {
          boardString += ' ';
        }
      }
    }
    
    return boardString;
  }

  // Check if game is over and return winner
  getGameResult(): { isOver: boolean; winner?: Turn; reason?: string } {
    if (this.catWinVerification()) {
      return { isOver: true, winner: Turn.Cat, reason: 'Cat reached the edge' };
    }
    
    if (this.catcherWinVerification()) {
      return { isOver: true, winner: Turn.Catcher, reason: 'Cat is trapped' };
    }
    
    return { isOver: false };
  }

  // Get all valid moves for current turn
  // Get valid moves as Position objects
  getValidMovePositions(): Position[] {
    const moves: Position[] = [];
    
    if (this.turn === Turn.Cat) {
      const neighbors = [
        this.NE(this.catPosition),
        this.NW(this.catPosition),
        this.E(this.catPosition),
        this.W(this.catPosition),
        this.SE(this.catPosition),
        this.SW(this.catPosition)
      ];
      
      for (const neighbor of neighbors) {
        if (this.catCanMoveToPosition(neighbor)) {
          moves.push(neighbor);
        }
      }
    } else {
      // For catcher, find all empty positions, exclude the cat position
      let catIndex = this.positionToIndex(this.catPosition);
      for (let i = 0; i < this.board.length; i++) {
        if (this.board[i] === '.' && i !== catIndex) {
          const pos = this.indexToPosition(i);
          if (this.catcherCanMoveToPosition(pos)) {
            moves.push(pos);
          }
        }
      }
    }
    
    return moves;
  }

  // Get valid moves as strings (backward compatibility)
  getValidMoves(): string[] {
    return this.getValidMovePositions().map(pos => `${pos.x},${pos.y}`);
  }
}