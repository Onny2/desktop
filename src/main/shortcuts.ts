import { app, globalShortcut } from 'electron';
import { togglePopup } from './popup';

const DEFAULT_HOTKEY = process.platform === 'darwin' ? 'CommandOrControl+Shift+L' : 'Control+Shift+L';

export function registerGlobalShortcuts(hotkey = DEFAULT_HOTKEY) {
  const ok = globalShortcut.register(hotkey, () => togglePopup(true));
  if (!ok) {
    console.warn('[quick-chat] Impossibile registrare la scorciatoia', hotkey);
  }
}

export function unregisterGlobalShortcuts() {
  globalShortcut.unregisterAll();
}

app.on('will-quit', unregisterGlobalShortcuts);