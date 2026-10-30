// The page that is printed: the drawing sheet with the circuit scaled onto it. It sits outside the application
// (a portal on the body) and is invisible on the screen; the print style sheet shows only this and hides the app.

import { createPortal } from 'react-dom';
import { SheetSvg } from './SheetSvg';
import { fitContent, type Box, type Paper, type SheetSettings } from './sheet';

export interface PrintJob {
  mode: 'print' | 'pdf';
  /** The markup of the circuit as the editor draws it, taken from the live canvas. */
  html: string;
  /** Its bounding box in pixels. */
  bbox: Box;
  sheet: SheetSettings;
  paper: Paper;
  lang: 'en' | 'tr';
}

export function PrintSheet({ job }: { job: PrintJob }) {
  const p = job.paper;
  const fit = fitContent(job.bbox, p);
  return createPortal(
    <div className="print-root print-light" style={{ width: `${p.w}mm`, height: `${p.h - 0.3}mm` }}>
      <style>{`@page { size: ${p.w}mm ${p.h}mm; margin: 0; }`}</style>
      <svg xmlns="http://www.w3.org/2000/svg" width={`${p.w}mm`} height={`${p.h}mm`} viewBox={`0 0 ${p.w} ${p.h}`}>
        <SheetSvg sheet={job.sheet} lang={job.lang} paper={p} />
        <g transform={`translate(${fit.tx} ${fit.ty}) scale(${fit.scale})`} dangerouslySetInnerHTML={{ __html: job.html }} />
      </svg>
    </div>,
    document.body,
  );
}
