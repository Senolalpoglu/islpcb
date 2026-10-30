// One conversation with Claude about the open project: the system prompt, the tool-use loop, and what is shown.
//
// The assistant messages are kept exactly as the API returned them (thinking blocks included) and sent back on the
// next request, as the API requires. Tool calls are carried out here, on the project, by tools.ts.

import { PART_FORMAT, TOOLS, executeToolAsync, type Workspace } from './tools';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
] as const;

export const DEFAULT_MODEL = MODELS[0].id;

export const SYSTEM_PROMPT = `You are the operator of ISL PCB, an electronics design program with a schematic editor, a circuit simulator and an automatic PCB layout. The user asks you, in their own words, to build or change designs inside the open project, and you do it with your tools. Answer in the language the user writes in (Turkish or English), briefly: say what you did and anything they need to know, not a long tutorial.

How the editor works
- The schematic is on a grid. x grows to the right, y grows down, one unit is one grid step. A part has an origin and pins at integer offsets from it (describe_part shows them). Typical spacing: keep parts at least 6 units apart.
- Wires are horizontal or vertical segments. Two things are connected when a wire end meets a pin or another wire end, or when an end lies on the middle of a wire. Wires that merely cross are NOT connected. Use connect (pin to pin); it routes around other pins. add_wire is for special cases.
- Every simulated circuit needs a GND symbol (type "GND") connected to the ground net. Sources are VDC (battery / DC supply, param v), VAC, VPULSE; passives R (r), C (c), L (l); LED, D, QNPN, NMOS and many more. Use search_parts to find a part, never guess a type id. Library parts have the type "x:<id>".
- Parameter values are in base units: ohms, farads, henries, volts. Parts can be rotated (rotate_part, with optional mirror); the wires follow.
- Microcontroller boards (ARDUINO_UNO, ARDUINO_NANO, ARDUINO_MEGA, PICO, PICO_W, PIC16F...) run real firmware in the simulator, but you cannot edit their program with your tools. Sensor and wireless modules (HX711, HC-05, ESP, nRF24 ...) are pinout-only: they have a footprint and draw supply current, but no protocol is simulated. Say so when it matters.

How to work
1. For a change to an existing design, call get_circuit first. For a new design, search_parts for every part, then add_part, then connect.
2. After wiring, call get_circuit and check that the nets are what you intended. If a connect result has a warning, check for accidental connections.
3. Verify with simulate_dc when the circuit is meant to do something measurable (voltages, LED current ...) and fix what is wrong. Report the key numbers.
4. PCB: use pcb_autolayout (sides = 1 for a single-sided board). It creates the footprints, arranges the parts, sizes the board, chooses track widths (power and ground wider) and routes, trying several arrangements. Do not place footprints by hand with pcb_place unless the user asks for a specific position. Add pcb_add_pour for a ground plane (net "GND") only on request, then pcb_status. Use show_view "pcb" at the end so the user sees it. If connections fail, say which: on a single-sided board they cross other tracks and need wire links (jumpers). pcb_update, pcb_settings and pcb_autoroute are for fine control of an existing board.
5. A part the library lacks is added, not refused: search_parts and list_library first, and when nothing fits, build it with define_part (JSON, see below) with the real pins, a model if it can be simulated, and the real package (footprintDef from the datasheet or the user's picture when the package is not built in). Then place it. A part you defined stays in the library for later projects.
6. Do not delete or rebuild the user's existing work unless asked. Do not claim something works unless you checked it.
7. Be careful with mains voltage: designs are for simulation and PCB prototypes; add a short safety note for anything above 50 V.

${PART_FORMAT}`;

/**
 * What a client that drives the program from outside (Claude Desktop through the MCP server) is told. The user may
 * attach a picture or a model; this client reads it, then builds it with the tools.
 */
export const MCP_INSTRUCTIONS = `${SYSTEM_PROMPT}

Working from Claude Desktop
- The user may attach a photo or drawing of a circuit, a schematic, a PCB or a part, or describe a model in words. Read it yourself, list the parts and connections you see (say what you are unsure of), then build it with these tools in the open project.
- Use capture_view after show_view to look at the schematic or the board and check your work against the picture.
- The program must be running with a project open; every tool acts on that project and the user sees the change at once.`;

export type Role = 'user' | 'assistant' | 'tool' | 'note' | 'error';

/** What the panel shows for one step of the conversation. */
export interface ChatItem {
  id: number;
  role: Role;
  text: string;
}

export type ApiMessage = { role: 'user' | 'assistant'; content: unknown };

type SendResult = Awaited<ReturnType<NonNullable<Window['snl']>['claudeSend']>>;

interface TurnOptions {
  model: string;
  history: ApiMessage[];
  userText: string;
  ws: Workspace;
  send: (request: { model: string; system: string; tools: unknown[]; messages: unknown[] }) => Promise<SendResult>;
  /** Called with every new line to show, and after each tool with the document as it now is. */
  onItem: (role: Role, text: string) => void;
  onDoc: (ws: Workspace) => void;
  cancelled: () => boolean;
}

const MAX_STEPS = 60;

/** A one-line description of a tool call for the chat. */
function describeCall(name: string, input: Record<string, unknown>): string {
  const brief = JSON.stringify(input);
  return brief.length > 140 ? `${name} ${brief.slice(0, 137)}…` : `${name} ${brief === '{}' ? '' : brief}`.trim();
}

/** Runs one user request to the end. Returns the conversation to keep for the next request. */
export async function runTurn(o: TurnOptions): Promise<ApiMessage[]> {
  const messages: ApiMessage[] = [...o.history, { role: 'user', content: o.userText }];
  for (let step = 0; step < MAX_STEPS; step++) {
    if (o.cancelled()) {
      o.onItem('note', 'Stopped.');
      return messages;
    }
    const res = await o.send({ model: o.model, system: SYSTEM_PROMPT, tools: TOOLS, messages });
    if (!res.ok) {
      o.onItem('error', res.error);
      // The last user message never got an answer: drop it so the next request starts clean.
      return o.history;
    }
    const { content, stop_reason: stop } = res.message;
    messages.push({ role: 'assistant', content });
    const blocks = content as Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    for (const b of blocks) if (b.type === 'text' && b.text?.trim()) o.onItem('assistant', b.text.trim());

    if (stop !== 'tool_use') {
      if (stop === 'refusal') o.onItem('note', 'Claude declined this request.');
      else if (stop === 'max_tokens') o.onItem('note', 'The answer was cut off (length limit). Ask it to continue.');
      return messages;
    }
    const results: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = [];
    for (const b of blocks) {
      if (b.type !== 'tool_use' || !b.id || !b.name) continue;
      const out = await executeToolAsync(o.ws, b.name, b.input ?? {});
      o.onItem('tool', describeCall(b.name, b.input ?? {}));
      results.push({ type: 'tool_result', tool_use_id: b.id, content: out, ...(out.startsWith('Error:') ? { is_error: true } : {}) });
      o.onDoc(o.ws);
    }
    messages.push({ role: 'user', content: results });
  }
  o.onItem('note', 'Stopped after many steps. Ask it to continue if it is not finished.');
  return messages;
}
