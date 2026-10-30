// Draws the drawing sheet (paper, frame, title block) in millimetres. The editor scales it to pixels and puts it
// behind the circuit; the printed page uses it as it is.

import { MARGIN_MM, titleBlockCells, titleBlockRect, type Paper, type SheetSettings } from './sheet';

interface Props {
  sheet: SheetSettings;
  lang: 'en' | 'tr';
  paper: Paper;
}

export function SheetSvg({ sheet, lang, paper: p }: Props) {
  const tb = titleBlockRect(p);
  return (
    <g className="sheet" pointerEvents="none">
      <rect className="sheet-paper" x={0} y={0} width={p.w} height={p.h} />
      <rect className="sheet-frame" x={MARGIN_MM} y={MARGIN_MM} width={p.w - 2 * MARGIN_MM} height={p.h - 2 * MARGIN_MM} />
      <g transform={`translate(${tb.x} ${tb.y})`}>
        <rect className="sheet-frame" x={0} y={0} width={tb.w} height={tb.h} />
        {titleBlockCells(sheet, lang, p).map((c, i) => (
          <g key={i}>
            <rect className="sheet-cell" x={c.x} y={c.y} width={c.w} height={c.h} />
            <text className="sheet-label" x={c.x + 0.8} y={c.y + 1.8}>
              {c.label}
            </text>
            <text className={`sheet-value${c.bold ? ' bold' : ''}`} x={c.x + 1.5} y={c.y + c.h - 0.9} fontSize={c.size}>
              {c.value}
            </text>
          </g>
        ))}
      </g>
    </g>
  );
}
