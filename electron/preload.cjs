// Exposes the few things the renderer may ask the main process to do. Nothing else crosses the bridge.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snl', {
  /** Resolves to true when arduino-cli can be found on this machine. */
  cliAvailable: () => ipcRenderer.invoke('arduino:available'),
  /** Compiles sketch source for a board. Resolves to { ok, hex, log }. */
  /** The Claude operator: key status, saving the key, and one conversation turn. */
  claudeStatus: () => ipcRenderer.invoke('claude:status'),
  claudeSetKey: (key) => ipcRenderer.invoke('claude:setKey', String(key)),
  claudeClearKey: () => ipcRenderer.invoke('claude:clearKey'),
  claudeSend: (request) => ipcRenderer.invoke('claude:send', request),
  /** Tells the main process whether the circuit has unsaved changes, with the texts for the "save before closing?" question. */
  setDirty: (dirty, strings) => ipcRenderer.send('app:dirty', { dirty: dirty === true, strings: strings && typeof strings === 'object' ? strings : undefined }),
  /** The main process asks for the text of the circuit file (the user chose to save while closing); answer with provideSave. */
  onSaveRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('app:save-request', handler);
    return () => ipcRenderer.removeListener('app:save-request', handler);
  },
  provideSave: (text) => ipcRenderer.send('app:save-text', String(text)),
  /** Claude Desktop access (MCP): state, switching it on or off, and the calls it sends to the open project. */
  bridgeStatus: () => ipcRenderer.invoke('bridge:status'),
  bridgeEnable: () => ipcRenderer.invoke('bridge:enable'),
  bridgeDisable: () => ipcRenderer.invoke('bridge:disable'),
  /** Announces the tools and instructions the page offers. */
  bridgeHello: (offer) => ipcRenderer.send('bridge:hello', { tools: Array.isArray(offer.tools) ? offer.tools : [], instructions: String(offer.instructions ?? '') }),
  /** Receives each tool call; returns a function that stops listening. Answer with bridgeReply. */
  onBridgeRequest: (callback) => {
    const handler = (_event, request) => callback(request);
    ipcRenderer.on('bridge:request', handler);
    return () => ipcRenderer.removeListener('bridge:request', handler);
  },
  bridgeReply: (reply) => ipcRenderer.send('bridge:reply', { id: Number(reply.id), text: String(reply.text ?? '') }),
  /** Prints the sheet that the page has put on the body, or saves it as PDF. Resolves to { ok, error?, path? }. */
  print: (opts) => ipcRenderer.invoke('print:run', { mode: opts.mode === 'pdf' ? 'pdf' : 'print', widthMm: Number(opts.widthMm), heightMm: Number(opts.heightMm) }),
  /** The COM ports the page can choose from (sent when it asks for one); returns a function that stops listening. */
  onSerialPorts: (callback) => {
    const handler = (_event, list) => callback(Array.isArray(list) ? list : []);
    ipcRenderer.on('serial:ports', handler);
    return () => ipcRenderer.removeListener('serial:ports', handler);
  },
  /** Answers the page's request for a port with the chosen id ("" for none). */
  serialChoose: (id) => ipcRenderer.send('serial:choose', String(id ?? '')),
  compile: (source, fqbn) => ipcRenderer.invoke('arduino:compile', String(source), typeof fqbn === 'string' ? fqbn : undefined),
});
