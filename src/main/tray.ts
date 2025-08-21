import { Menu, Tray, nativeImage } from 'electron';
import * as path from 'node:path';
import { togglePopup } from './popup';

let tray: Tray | null = null;

export function createTray() {
  if (tray) return tray;
  const iconPath = path.join(process.resourcesPath, 'icons', process.platform === 'win32' ? 'tray.ico' : 'trayTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);

  tray.setToolTip('Open WebUI – Quick Chat');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Apri Quick Chat', click: () => togglePopup(false) },
    { type: 'separator' },
    { label: 'Esci', role: 'quit' },
  ]));

  tray.on('click', () => togglePopup(false));
  return tray;
}