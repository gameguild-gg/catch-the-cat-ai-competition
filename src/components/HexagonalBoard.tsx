// Hexagonal Board Component with proper SVG rendering
interface HexagonalBoardProps {
  boardString: string;
  catPosition: { x: number; y: number };
  side?: number;
  onCellClick?: (x: number, y: number) => void;
  highlightCells?: Set<string>;
}

export function HexagonalBoard({ boardString, catPosition, side = 21, onCellClick, highlightCells }: HexagonalBoardProps) {
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

      const isHighlighted = isEmpty && highlightCells !== undefined && highlightCells.has(`${x},${y}`);

      if (isHighlighted) {
        fillColor = '#fbbf24';
        strokeColor = '#d97706';
        strokeWidth = 2;
      }

      hexagons.push(
        <g key={`hex-${x}-${y}`} className="hexagon-cell group">
          <path
            d={generateHexagonPath(centerX, centerY, hexSize)}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            onClick={isEmpty && onCellClick ? () => onCellClick(x, y) : undefined}
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
