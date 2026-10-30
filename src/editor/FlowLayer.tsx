import { GRID, type Part } from './model';
import { partBounds } from './bounds';
import { NO_CURRENT, flowSpeed, voltColor, wireState, type Flow } from './flow';
import { useI18n } from '../i18n';

/** How the flow view is drawn; the same choices the toolbar offers. */
export interface FlowView {
  /** Colour the wires and move dashes along them in the direction of the current. */
  on: boolean;
  /** `state`: red where the wire is live, blue on the 0 V side, nothing where it is not powered. `volt`: a colour for every voltage. */
  palette: 'state' | 'volt';
  /** Draw the direction the electrons move (against the conventional current) instead of the conventional one. */
  electrons: boolean;
  /** A single click on a switch flips it, without having to double-click. */
  interactive: boolean;
  /** The dashes move; they stand still while the simulation is paused. */
  animate: boolean;
}

/** Seconds one dash period takes at each speed level of `flowSpeed`; level 0 is no motion. */
const PERIOD = [0, 2.6, 1.9, 1.35, 0.95, 0.65, 0.45];
/** A stretch needs this much room (in pixels) before an arrowhead fits on it. */
const ARROW_ROOM = GRID * 1.6;
const LIVE = '#d63a3a';
const ZERO = '#2f6fdd';

interface Props {
  flow: Flow;
  view: FlowView;
  switches: { part: Part; closed: boolean }[];
  /** Parts that are on right now: closed switches, lit lamps, pulled-in relays, running motors. */
  lit: Part[];
}

/**
 * Drawn over the wires: each stretch takes the colour of its state or voltage, and where a current flows, dashes run
 * along it in the direction of the current with an arrowhead in the middle. Parts that are on get a small ON tag, and
 * switches a CLOSED / OPEN one.
 */
export function FlowLayer({ flow, view, switches, lit }: Props) {
  const { t } = useI18n();
  return (
    <g className="flow-layer" pointerEvents="none">
      {flow.segs.map((g, k) => {
        const x1 = g.a.x * GRID;
        const y1 = g.a.y * GRID;
        const x2 = g.b.x * GRID;
        const y2 = g.b.y * GRID;
        const state = wireState(g, flow.vmax, flow.rails);
        // A wire that is not powered keeps the colour of the sheet in the state palette.
        if (view.palette === 'state' && state === null) return null;
        const color = view.palette === 'state' ? (state === 'live' ? LIVE : ZERO) : voltColor(g.volts, flow.vmax);
        // Conventional current a -> b is positive; the electrons run the other way.
        const signed = g.amps === null ? 0 : view.electrons ? -g.amps : g.amps;
        const level = g.amps === null || Math.abs(g.amps) < NO_CURRENT ? 0 : flowSpeed(g.amps);
        const forward = signed >= 0;
        const len = Math.hypot(x2 - x1, y2 - y1);
        const angle = (Math.atan2(forward ? y2 - y1 : y1 - y2, forward ? x2 - x1 : x1 - x2) * 180) / Math.PI;
        const dur = { animationDuration: `${PERIOD[level]}s`, animationPlayState: view.animate ? 'running' : 'paused' } as const;
        return (
          <g key={`${g.wireId}-${k}`}>
            {view.palette === 'state' ? (
              level > 0 ? (
                <>
                  {/* The sheet's own wire is hidden under the dashes so the gaps between them stay empty. */}
                  <line x1={x1} y1={y1} x2={x2} y2={y2} className="flow-mask" />
                  <line x1={x1} y1={y1} x2={x2} y2={y2} className={`flow-run ${forward ? 'fwd' : 'rev'}`} stroke={color} style={dur} />
                </>
              ) : (
                <line x1={x1} y1={y1} x2={x2} y2={y2} className="flow-solid" stroke={color} />
              )
            ) : (
              <>
                <line x1={x1} y1={y1} x2={x2} y2={y2} className="flow-wire" stroke={color} strokeWidth={2.6 + Math.min(2, level * 0.35)} />
                {level > 0 && <line x1={x1} y1={y1} x2={x2} y2={y2} className={`flow-dash ${forward ? 'fwd' : 'rev'}`} style={dur} />}
              </>
            )}
            {level > 0 && len >= ARROW_ROOM && (
              <polygon className="flow-arrow" points="-5,-4.5 5,0 -5,4.5" fill={color} transform={`translate(${(x1 + x2) / 2} ${(y1 + y2) / 2}) rotate(${angle})`} />
            )}
          </g>
        );
      })}
      {lit.map((part) => {
        const b = partBounds(part);
        if (!b) return null;
        return (
          <g key={`on-${part.id}`} className="flow-on" transform={`translate(${b.x0 * GRID - 2} ${b.y0 * GRID - 6})`}>
            <rect x={-26} y={-8} width={26} height={15} rx={7.5} />
            <text x={-13} y={3} textAnchor="middle">
              ON
            </text>
          </g>
        );
      })}
      {view.interactive &&
        switches.map(({ part, closed }) => {
          const b = partBounds(part);
          if (!b) return null;
          const label = t(closed ? 'flow.closed' : 'flow.open');
          const w = label.length * 6.4 + 12;
          return (
            <g key={part.id} className={`flow-tag ${closed ? 'on' : ''}`} transform={`translate(${((b.x0 + b.x1) / 2) * GRID} ${b.y1 * GRID + 14})`}>
              <rect x={-w / 2} y={-9} width={w} height={16} rx={8} />
              <text y={3} textAnchor="middle">
                {label}
              </text>
            </g>
          );
        })}
    </g>
  );
}
