/** State of the Claude Desktop (MCP) access, from electron/bridge.cjs. */
interface BridgeStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  /** Claude Desktop's configuration file the MCP server is registered in. */
  configFile: string;
  installed: boolean;
  appReady: boolean;
}

/** The bridge exposed by electron/preload.cjs. Absent when the page runs in a plain browser. */
interface SnlBridge {
  cliAvailable(): Promise<boolean>;
  onSerialPorts?(callback: (ports: Array<{ id: string; name: string; display: string; vid?: number; pid?: number }>) => void): () => void;
  serialChoose?(id: string): void;
  print(opts: { mode: 'print' | 'pdf'; size: string; landscape: boolean; widthMm: number; heightMm: number }): Promise<{ ok: boolean; error?: string; path?: string }>;
  compile(source: string, fqbn?: string): Promise<{ ok: boolean; hex: string; log: string }>;
  claudeStatus(): Promise<{ hasKey: boolean; source: 'saved' | 'env' | null }>;
  claudeSetKey(key: string): Promise<{ ok: boolean; error?: string; encrypted?: boolean }>;
  claudeClearKey(): Promise<{ ok: boolean }>;
  setDirty(dirty: boolean, strings?: { title: string; message: string; save: string; discard: string; cancel: string; failed: string }): void;
  onSaveRequest(callback: () => void): () => void;
  provideSave(text: string): void;
  bridgeStatus(): Promise<BridgeStatus>;
  bridgeEnable(): Promise<BridgeStatus & { ok: boolean; error?: string }>;
  bridgeDisable(): Promise<BridgeStatus & { ok: boolean }>;
  bridgeHello(offer: { tools: unknown[]; instructions: string }): void;
  onBridgeRequest(callback: (request: { id: number; tool: string; input: Record<string, unknown> }) => void): () => void;
  bridgeReply(reply: { id: number; text: string }): void;
  claudeSend(request: { model: string; system: string; tools: unknown[]; messages: unknown[] }): Promise<
    { ok: true; message: { content: unknown[]; stop_reason: string | null; usage?: { input_tokens: number; output_tokens: number } } } | { ok: false; error: string }
  >;
}

interface Window {
  snl?: SnlBridge;
}
