// Runs autoLayout off the page's main thread, so the editor stays responsive during a long placement and routing.

import { loadBuiltinLibrary, registerEmbedded } from '../editor/library';
import { autoLayout } from './layout';
import type { LayoutJob, LayoutReply } from './layoutAsync';

const scope = self as unknown as { onmessage: ((e: MessageEvent<LayoutJob>) => void) | null; postMessage(message: LayoutReply): void };

scope.onmessage = (e) => {
  const { doc, pcb, opts, specs } = e.data;
  try {
    // The worker has its own copy of the part library: the shipped parts, plus the user parts this document uses.
    loadBuiltinLibrary();
    registerEmbedded(specs);
    const { fixed, ...rest } = opts;
    const result = autoLayout(doc, pcb, { ...rest, ...(fixed ? { fixed: new Set(fixed) } : {}) });
    scope.postMessage({ ok: true, result });
  } catch (err) {
    scope.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
