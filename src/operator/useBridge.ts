// Runs the tool calls that arrive from Claude Desktop (through the MCP server and the bridge in the main process) on the
// open project. It lives in the app, not in the assistant panel, so it works while the panel is closed.

import { useEffect, useRef } from 'react';
import type { Doc } from '../editor/model';
import { layoutInWorker } from '../pcb/layoutAsync';
import { MCP_INSTRUCTIONS } from './session';
import { TOOLS, executeToolAsync, type Workspace } from './tools';

interface Options {
  doc: Doc;
  /** Receives the document after a call changed it, without adding an undo step. */
  onDoc: (d: Doc) => void;
  /** Marks one undo step, so a single Undo takes back a whole burst of calls. */
  onCheckpoint: () => void;
  onLibraryChanged: () => void;
  onShowView: (view: 'schematic' | 'pcb') => void;
}

/** Calls closer together than this belong to one request from the user and share one undo step. */
const BURST_MS = 30_000;

export function useBridge(o: Options): void {
  const latest = useRef(o);
  latest.current = o;
  // The newest document. It runs ahead of React's state while calls follow each other quickly.
  const docRef = useRef(o.doc);
  docRef.current = o.doc;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const lastChange = useRef(0);

  useEffect(() => {
    const snl = window.snl;
    if (!snl?.onBridgeRequest) return;

    const run = async (req: { id: number; tool: string; input: Record<string, unknown> }): Promise<void> => {
      const cur = latest.current;
      const ws: Workspace = { doc: docRef.current, onLibraryChanged: cur.onLibraryChanged, showView: cur.onShowView, layoutAsync: layoutInWorker };
      const before = ws.doc;
      let text: string;
      try {
        text = await executeToolAsync(ws, req.tool, req.input);
      } catch (e) {
        text = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (ws.doc !== before) {
        const now = Date.now();
        if (now - lastChange.current > BURST_MS) cur.onCheckpoint();
        lastChange.current = now;
        docRef.current = ws.doc;
        cur.onDoc(ws.doc);
      }
      snl.bridgeReply({ id: req.id, text });
    };

    // One call at a time, in the order they arrive: each one starts from the result of the one before.
    const stop = snl.onBridgeRequest((req) => {
      queue.current = queue.current.then(() => run(req)).catch(() => undefined);
    });
    snl.bridgeHello({ tools: TOOLS, instructions: MCP_INSTRUCTIONS });
    return stop;
  }, []);
}
