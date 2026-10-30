// autoLayout in a Web Worker. Falls back to the main thread where workers are not available or cannot start
// (tests, a page opened from a file in a browser that forbids it), so the result is the same either way.

import { usedUserSpecs } from '../editor/library';
import type { Doc } from '../editor/model';
import type { PcbDoc } from '../../core/pcb/types';
import { autoLayout, type LayoutOptions, type LayoutResult } from './layout';

/** What the page sends to the worker. Plain data only: sets become arrays. */
export interface LayoutJob {
  doc: Doc;
  pcb: PcbDoc;
  opts: Omit<LayoutOptions, 'fixed'> & { fixed?: string[] };
  /** The user-defined parts the document uses; the shipped ones the worker loads itself. */
  specs: unknown[];
}

export type LayoutReply = { ok: true; result: LayoutResult } | { ok: false; error: string };

/** Lays out the board without blocking the page. */
export function layoutInWorker(doc: Doc, pcb: PcbDoc, opts: LayoutOptions = {}): Promise<LayoutResult> {
  const inline = (): Promise<LayoutResult> => Promise.resolve().then(() => autoLayout(doc, pcb, opts));
  if (typeof Worker === 'undefined') return inline();
  return new Promise<LayoutResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      inline().then(resolve, reject);
      return;
    }
    let settled = false;
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      worker.terminate();
      fn();
    };
    worker.onmessage = (e: MessageEvent<LayoutReply>) => done(() => (e.data.ok ? resolve(e.data.result) : reject(new Error(e.data.error))));
    // The worker could not start (blocked script, missing file): do the work here instead.
    worker.onerror = (e) => {
      e.preventDefault();
      done(() => inline().then(resolve, reject));
    };
    const { fixed, ...rest } = opts;
    const job: LayoutJob = { doc, pcb, opts: { ...rest, ...(fixed ? { fixed: [...fixed] } : {}) }, specs: usedUserSpecs(doc) };
    worker.postMessage(job);
  });
}
