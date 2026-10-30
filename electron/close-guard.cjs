// Asks "save before closing?" when the window is closed with changes that were not saved.
//
// The page reports whether the circuit has unsaved changes (and the texts for the question in the language of the
// program) through 'app:dirty'. When the window is about to close with unsaved changes, the close is held back and
// the user chooses: save (the page hands over the file text, a save dialog picks the place), discard, or cancel.

const SAVE_REPLY_TIMEOUT_MS = 10000;

const DEFAULT_STRINGS = {
  title: 'ISL PCB',
  message: 'The circuit has changes that are not saved. Save them before closing?',
  save: 'Save',
  discard: "Don't save",
  cancel: 'Cancel',
  failed: 'The circuit could not be read for saving, so the window stays open.',
};

/** `ipcMain`, `dialog` and `fs` are passed in so the logic can be tested without Electron. */
function createCloseGuard({ ipcMain, dialog, fs }) {
  let state = { dirty: false, strings: DEFAULT_STRINGS };

  ipcMain.on('app:dirty', (_event, report) => {
    state = { dirty: report?.dirty === true, strings: { ...DEFAULT_STRINGS, ...(report?.strings ?? {}) } };
  });

  /** Asks the page for the text of the circuit file. Resolves to null if it does not answer in time. */
  function askPageForFile(win) {
    return new Promise((resolve) => {
      const onText = (_event, text) => {
        clearTimeout(timer);
        resolve(typeof text === 'string' ? text : null);
      };
      const timer = setTimeout(() => {
        ipcMain.removeListener('app:save-text', onText);
        resolve(null);
      }, SAVE_REPLY_TIMEOUT_MS);
      ipcMain.once('app:save-text', onText);
      win.webContents.send('app:save-request');
    });
  }

  async function saveThenClose(win, strings, close) {
    const text = await askPageForFile(win);
    if (text === null) {
      dialog.showErrorBox(strings.title, strings.failed);
      return;
    }
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: 'circuit.islpcb', filters: [{ name: 'ISL PCB', extensions: ['islpcb'] }] });
    if (canceled || !filePath) return; // the user changed their mind: the window stays open
    try {
      fs.writeFileSync(filePath, text);
    } catch (e) {
      dialog.showErrorBox(strings.title, String(e && e.message ? e.message : e));
      return;
    }
    close();
  }

  return {
    attach(win) {
      let closing = false;
      const close = () => {
        closing = true;
        win.close();
      };
      // A reloaded page starts clean and reports again.
      win.webContents.on('did-start-loading', () => {
        state = { dirty: false, strings: DEFAULT_STRINGS };
      });
      win.on('close', (event) => {
        if (closing || !state.dirty) return;
        event.preventDefault();
        const s = state.strings;
        const choice = dialog.showMessageBoxSync(win, { type: 'question', buttons: [s.save, s.discard, s.cancel], defaultId: 0, cancelId: 2, noLink: true, title: s.title, message: s.message });
        if (choice === 1) close();
        else if (choice === 0) void saveThenClose(win, s, close);
      });
    },
  };
}

module.exports = { createCloseGuard, DEFAULT_STRINGS };
