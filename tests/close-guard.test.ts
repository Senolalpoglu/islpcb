import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createCloseGuard, DEFAULT_STRINGS } = require('../electron/close-guard.cjs');

const TEXTS = { title: 'T', message: 'Save?', save: 'Kaydet', discard: 'Kaydetme', cancel: 'İptal', failed: 'Failed' };

/** A window that can be closed, with the 'close' event the guard listens to. */
function fakeWindow() {
  const win = new EventEmitter() as EventEmitter & { webContents: EventEmitter & { send: ReturnType<typeof vi.fn> }; close: () => void; closed: boolean };
  win.webContents = Object.assign(new EventEmitter(), { send: vi.fn() });
  win.closed = false;
  win.close = () => {
    // Like Electron: 'close' is emitted first and the window only goes away when nobody prevents it.
    let prevented = false;
    win.emit('close', { preventDefault: () => (prevented = true) });
    if (!prevented) win.closed = true;
  };
  return win;
}

function setup(choice: number, save: { canceled: boolean; filePath?: string } = { canceled: false, filePath: 'C:/x/circuit.islpcb' }) {
  const ipcMain = new EventEmitter();
  const dialog = {
    showMessageBoxSync: vi.fn((..._args: any[]) => choice),
    showSaveDialog: vi.fn(async (..._args: any[]) => save),
    showErrorBox: vi.fn(),
  };
  const fs = { writeFileSync: vi.fn() };
  const win = fakeWindow();
  createCloseGuard({ ipcMain, dialog, fs }).attach(win);
  const report = (dirty: boolean) => ipcMain.emit('app:dirty', {}, { dirty, strings: TEXTS });
  /** The page answering the request to save. */
  win.webContents.send.mockImplementation((channel: string) => {
    if (channel === 'app:save-request') queueMicrotask(() => ipcMain.emit('app:save-text', {}, '{"parts":[]}'));
  });
  return { ipcMain, dialog, fs, win, report };
}

describe('closing the window', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('closes at once when nothing has changed', () => {
    const { win, dialog } = setup(2);
    win.close();
    expect(win.closed).toBe(true);
    expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
  });

  it('asks when there are unsaved changes, in the texts the page gave, and Cancel keeps the window open', () => {
    const { win, dialog, report } = setup(2);
    report(true);
    win.close();
    expect(win.closed).toBe(false);
    const options = dialog.showMessageBoxSync.mock.calls[0][1];
    expect(options.buttons).toEqual(['Kaydet', 'Kaydetme', 'İptal']);
    expect(options.message).toBe('Save?');
    expect(options.cancelId).toBe(2);
  });

  it("closes without saving on \"Don't save\"", () => {
    const { win, fs, report } = setup(1);
    report(true);
    win.close();
    expect(win.closed).toBe(true);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('asks the page for the file, writes it where the user chose, then closes', async () => {
    const { win, fs, dialog, report } = setup(0);
    report(true);
    win.close();
    expect(win.closed).toBe(false); // held back until the file is written
    await vi.waitFor(() => expect(win.closed).toBe(true));
    expect(win.webContents.send).toHaveBeenCalledWith('app:save-request');
    expect(dialog.showSaveDialog.mock.calls[0][1].defaultPath).toBe('circuit.islpcb');
    expect(fs.writeFileSync).toHaveBeenCalledWith('C:/x/circuit.islpcb', '{"parts":[]}');
  });

  it('keeps the window open when the user cancels the save dialog or the file cannot be written', async () => {
    const cancelled = setup(0, { canceled: true });
    cancelled.report(true);
    cancelled.win.close();
    await vi.waitFor(() => expect(cancelled.dialog.showSaveDialog).toHaveBeenCalled());
    await Promise.resolve();
    expect(cancelled.win.closed).toBe(false);
    expect(cancelled.fs.writeFileSync).not.toHaveBeenCalled();

    const broken = setup(0);
    broken.fs.writeFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });
    broken.report(true);
    broken.win.close();
    await vi.waitFor(() => expect(broken.dialog.showErrorBox).toHaveBeenCalledWith('T', 'disk full'));
    expect(broken.win.closed).toBe(false);
  });

  it('stays open and says so when the page does not hand over the file', async () => {
    const { win, dialog, report } = setup(0);
    win.webContents.send.mockImplementation(() => undefined); // the page never answers
    report(true);
    win.close();
    await vi.advanceTimersByTimeAsync(10_001);
    expect(dialog.showErrorBox).toHaveBeenCalledWith('T', 'Failed');
    expect(win.closed).toBe(false);
  });

  it('forgets the unsaved state when the page reloads, and when the page reports a clean circuit', () => {
    const reloaded = setup(2);
    reloaded.report(true);
    reloaded.win.webContents.emit('did-start-loading');
    reloaded.win.close();
    expect(reloaded.win.closed).toBe(true);

    const saved = setup(2);
    saved.report(true);
    saved.report(false);
    saved.win.close();
    expect(saved.win.closed).toBe(true);
  });

  it('has English texts to fall back on', () => {
    expect(Object.keys(DEFAULT_STRINGS).sort()).toEqual(['cancel', 'discard', 'failed', 'message', 'save', 'title']);
  });
});
