import { getCategoryColor } from "@/components/shelves/data/shelfConfig";

const ROWS = 6;
const COLS = 10;
const TOTAL_CELLS = ROWS * COLS; // 60

export interface DotSegment {
  category: string;
  groups: number; // 0.5 = 20 cells, 1.0 = 40 cells
}

interface ShelfDotGridProps {
  segments: DotSegment[];
  /** Optional fixed width for the entire grid container (px). If omitted, grid fills its parent width. */
  gridWidth?: number;
}

/**
 * Shelf dot grid: 4 rows × 10 cols of small rectangles.
 * Each cell has aspect-ratio 2/15, layers separated by 2px grey lines.
 * The overall card naturally becomes ~1:3 vertical rectangle.
 */
export const ShelfDotGrid = ({ segments, gridWidth }: ShelfDotGridProps) => {
  const cells: { color: string }[] = [];

  // Normalize ratios to proportions (they may be actual group counts like 1.5, 2.0)
  const totalRatio = segments.reduce((s, seg) => s + seg.groups, 0);

  for (const seg of segments) {
    const proportion = totalRatio > 0 ? seg.groups / totalRatio : 0;
    const segCells = Math.round(proportion * TOTAL_CELLS);
    const color = getCategoryColor(seg.category);
    for (let i = 0; i < segCells && cells.length < TOTAL_CELLS; i++) {
      cells.push({ color });
    }
  }

  while (cells.length < TOTAL_CELLS) {
    const lastColor = cells.length > 0 ? cells[cells.length - 1].color : "#CBD5E0";
    cells.push({ color: lastColor });
  }

  // Render as 4 rows, each row is a 10-col grid, with 2px dividers between rows
  const rowArrays: { color: string }[][] = [];
  for (let r = 0; r < ROWS; r++) {
    rowArrays.push(cells.slice(r * COLS, (r + 1) * COLS));
  }

  return (
    <div
      className="flex flex-col w-full"
      style={{
        ...(gridWidth ? { width: gridWidth } : {}),
        aspectRatio: "1 / 1",
      }}
    >
      {rowArrays.map((row, ri) => (
        <div key={ri} className="flex-1 min-h-0">
          <div
            className="grid w-full h-full"
            style={{
              gridTemplateColumns: `repeat(${COLS}, 1fr)`,
              gap: "1px",
            }}
          >
            {row.map((cell, ci) => (
              <div
                key={ci}
                className="transition-colors duration-500"
                style={{
                  backgroundColor: cell.color,
                  opacity: 0.85,
                }}
              />
            ))}
          </div>
          {ri < ROWS - 1 && (
            <div style={{ height: 2, backgroundColor: "hsl(var(--border))" }} />
          )}
        </div>
      ))}
    </div>
  );
};

/**
 * ShelfDotGrid with a dashed divider between different category segments.
 * For a shelf with two 0.5-group segments, shows top 2 rows + divider + bottom 2 rows.
 */
export const ShelfDotGridWithDivider = ({ segments, gridWidth }: ShelfDotGridProps) => {
  if (segments.length <= 1) {
    return <ShelfDotGrid segments={segments} gridWidth={gridWidth} />;
  }

  // Normalize ratios to proportions
  const totalRatio = segments.reduce((s, seg) => s + seg.groups, 0);
  const firstProportion = totalRatio > 0 ? segments[0].groups / totalRatio : 0.5;
  const firstCells = Math.round(firstProportion * TOTAL_CELLS);
  const firstRows = Math.max(1, Math.min(ROWS - 1, Math.ceil(firstCells / COLS)));
  const bottomRowCount = ROWS - firstRows;

  const topColor = getCategoryColor(segments[0].category);
  const bottomColor = getCategoryColor(segments[1].category);

  const renderRows = (color: string, rowCount: number, keyPrefix: string) => {
    const rows = [];
    for (let r = 0; r < rowCount; r++) {
      rows.push(
        <div key={`${keyPrefix}-${r}`} className="flex-1 min-h-0">
          <div
            className="grid w-full h-full"
            style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: "1px" }}
          >
            {Array.from({ length: COLS }, (_, ci) => (
              <div
                key={ci}
                className="transition-colors duration-500"
                style={{ backgroundColor: color, opacity: 0.85 }}
              />
            ))}
          </div>
          {r < rowCount - 1 && (
            <div style={{ height: 2, backgroundColor: "hsl(var(--border))" }} />
          )}
        </div>
      );
    }
    return rows;
  };

  return (
    <div
      className="flex flex-col w-full"
      style={{
        ...(gridWidth ? { width: gridWidth } : {}),
        aspectRatio: "1 / 1",
      }}
    >
      {renderRows(topColor, firstRows, "t")}
      <div className="border-t-2 border-dashed border-muted-foreground/40" />
      {renderRows(bottomColor, bottomRowCount, "b")}
    </div>
  );
};
