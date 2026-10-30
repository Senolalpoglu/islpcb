// The Claude operator's connection to the Anthropic API.
//
// The renderer runs the conversation and carries out the tool calls on the open project; this file only holds the
// API key and makes the one request per turn. The key never reaches the page: it is stored encrypted with the
// operating system's credential store (Electron safeStorage) and read here. ANTHROPIC_API_KEY, when set in the
// environment, is used if no key was saved.

const { app, ipcMain, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const keyFile = () => path.join(app.getPath('userData'), 'claude-key.bin');

function savedKey() {
  try {
    const raw = fs.readFileSync(keyFile());
    if (raw.length === 0) return null;
    if (raw.subarray(0, 6).toString() === 'plain:') return raw.subarray(6).toString('utf8');
    return safeStorage.decryptString(raw);
  } catch {
    return null;
  }
}

function currentKey() {
  const saved = savedKey();
  if (saved) return { key: saved, source: 'saved' };
  if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: 'env' };
  return { key: null, source: null };
}

/** A short reason in plain words for an API failure, using the SDK's typed errors. */
function describe(error) {
  if (error instanceof Anthropic.AuthenticationError) return 'The API key was rejected (401). Check it in the Claude settings.';
  if (error instanceof Anthropic.PermissionDeniedError) return 'This key is not allowed to use that model (403).';
  if (error instanceof Anthropic.NotFoundError) return 'Model not found (404). Pick another model in the Claude settings.';
  if (error instanceof Anthropic.RateLimitError) return 'Rate limited (429). Wait a moment and try again.';
  if (error instanceof Anthropic.BadRequestError) return `The request was rejected (400): ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return 'Could not reach api.anthropic.com. Check the internet connection.';
  if (error instanceof Anthropic.APIError) return `API error ${error.status}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function register() {
  ipcMain.handle('claude:status', () => {
    const { source } = currentKey();
    return { hasKey: source !== null, source };
  });

  ipcMain.handle('claude:setKey', (_event, key) => {
    const text = typeof key === 'string' ? key.trim() : '';
    if (!text) return { ok: false, error: 'Empty key.' };
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(keyFile(), safeStorage.encryptString(text));
    else fs.writeFileSync(keyFile(), Buffer.concat([Buffer.from('plain:'), Buffer.from(text, 'utf8')]));
    return { ok: true, encrypted: safeStorage.isEncryptionAvailable() };
  });

  ipcMain.handle('claude:clearKey', () => {
    fs.rmSync(keyFile(), { force: true });
    return { ok: true };
  });

  /** One turn: the renderer sends the conversation so far and gets the assistant message back unchanged. */
  ipcMain.handle('claude:send', async (_event, request) => {
    const { key } = currentKey();
    if (!key) return { ok: false, error: 'No API key. Add one in the Claude settings.' };
    try {
      const client = new Anthropic({ apiKey: key, maxRetries: 2 });
      const message = await client.messages.create({
        model: String(request.model),
        max_tokens: 16000,
        cache_control: { type: 'ephemeral' },
        system: String(request.system),
        tools: request.tools,
        messages: request.messages,
      });
      return { ok: true, message: { content: message.content, stop_reason: message.stop_reason, usage: message.usage } };
    } catch (error) {
      return { ok: false, error: describe(error) };
    }
  });
}

module.exports = { register };
