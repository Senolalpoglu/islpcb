// The COM port of the application: one ComBridge for the window, the list of ports the user can choose from (the
// Electron main process sends it when the page asks for a port), and a re-render whenever the connection changes.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ComBridge, browserSerial } from './comPort';

/** One serial port the user can choose, as the main process lists it. */
export interface PortChoice {
  id: string;
  /** "COM3" */
  name: string;
  /** "USB-SERIAL CH340 (COM3)" */
  display: string;
  vid?: number;
  pid?: number;
}

export function useComPort(onRx: (bytes: Uint8Array) => void) {
  const bridge = useRef<ComBridge | null>(null);
  if (bridge.current === null) bridge.current = new ComBridge(browserSerial());
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [choices, setChoices] = useState<PortChoice[] | null>(null);
  const rx = useRef(onRx);
  rx.current = onRx;

  useEffect(() => {
    const b = bridge.current!;
    b.onChange = bump;
    b.onRx = (bytes) => rx.current(bytes);
    const off = window.snl?.onSerialPorts?.((list) => setChoices(list));
    return () => {
      off?.();
      void b.disconnect();
    };
  }, []);

  /** The user chose a port in the list ("" for none): the pending request of the page is answered. */
  const pick = useCallback((id: string) => {
    setChoices(null);
    window.snl?.serialChoose?.(id);
  }, []);

  return { bridge: bridge.current, choices, pick };
}
