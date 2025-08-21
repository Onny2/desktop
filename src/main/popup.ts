import { BrowserWindow, screen, app } from 'electron';
import * as path from 'node:path';

let popupWindow: BrowserWindow | null = null;

export function createPopupWindow() {
  if (popupWindow) return popupWindow;

  popupWindow = new BrowserWindow({
    width: 420,
    height: 560,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    roundedCorners: true,
    vibrancy: process.platform === 'darwin' ? 'sidebar' : undefined,
    visualEffectState: process.platform === 'darwin' ? 'active' : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/popup.preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  // Mostrati su tutti i desktop/spazi
  try {
    popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (_) {}

  // Carica la micro-UI locale (vedi sezione 4)
  const url = app.isPackaged
    ? new URL(`file://${path.join(__dirname, '../renderer/mini-chat/index.html')}`).toString()
    : 'http://localhost:5173/mini-chat'; // es: se usi Vite dev server con una route
  popupWindow.loadURL(url);

  // Chiudi quando perde focus (opzionale)
  popupWindow.on('blur', () => popupWindow?.hide());

  return popupWindow;
}

export function togglePopup(positionNearCursor = true) {
  const win = createPopupWindow();

  if (win.isVisible()) {
    win.hide();
    return;
  }

  // Posiziona vicino al cursore (o in alto a destra)
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const margin = 16;
  const x = positionNearCursor
    ? Math.min(
        Math.max(cursor.x - Math.floor(win.getBounds().width / 2), display.workArea.x + margin),
        display.workArea.x + display.workArea.width - win.getBounds().width - margin
      )
    : display.workArea.x + display.workArea.width - win.getBounds().width - margin;

  const y = positionNearCursor
    ? Math.min(
        cursor.y + 20,
        display.workArea.y + display.workArea.height - win.getBounds().height - margin
      )
    : display.workArea.y + margin;

  win.setPosition(x, y, false);
  win.showInactive(); // mostra senza rubare focus "aggressivamente"
  win.focus();
}