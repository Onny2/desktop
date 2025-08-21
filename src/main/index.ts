// @ts-nocheck

import {
  app,
  shell,
  session,
  clipboard,
  nativeImage,
  desktopCapturer,
  BrowserWindow,
  globalShortcut,
  Notification,
  Menu,
  ipcMain,
  Tray,
  screen
} from "electron";
import path, { join } from "path";
import fs from "node:fs";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";

import {
  getLogFilePath,
  checkUrlAndOpen,
  getConfig,
  getServerLog,
  installPackage,
  installPython,
  isPackageInstalled,
  isPythonInstalled,
  isUvInstalled,
  openUrl,
  resetApp,
  setConfig,
  startServer,
  stopAllServers,
  uninstallPython,
} from "./utils";

import log from "electron-log";
log.transports.file.resolvePathFn = () => getLogFilePath("main");

import icon from "../../resources/icon.png?asset";
import trayIconImage from "../../resources/assets/tray.png?asset";

// ------------------- Stato App -------------------
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuiting = false;

let CONFIG: any | null = null;
let SERVER_URL: string | null = null;
let SERVER_STATUS: string | null = null;
let SERVER_REACHABLE = false;
let SERVER_PID: number | null = null;

// ------------------- Quick Chat Popup -------------------
let popupWindow: BrowserWindow | null = null;
const QUICK_CHAT_HOTKEY =
  process.platform === "darwin" ? "CommandOrControl+Shift+L" : "Control+Shift+L";

function createPopupWindow(): BrowserWindow {
  if (popupWindow) return popupWindow;

  popupWindow = new BrowserWindow({
    width: 420,
    height: 560,
    minWidth: 360,
    minHeight: 420,
    show: false,
    frame: false,
    resizable: false,
    // niente trasparenza: seguiamo i colori della mini-UI
    transparent: false,
    backgroundColor: "#0e1217",
    alwaysOnTop: true,
    skipTaskbar: true,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: join(__dirname, "../preload/popup.js"), // preload minimale per quick chat
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // consentiamo richieste locali dalla mini-UI file://, ma il proxy evita CORS comunque
      webSecurity: false,
    },
  });

  try {
    popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {}

  popupWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  popupWindow.on("blur", () => popupWindow?.hide());

  if (!app.isPackaged) {
    // utile per debug del popup
    // popupWindow.webContents.openDevTools({ mode: "detach" });
  }

  return popupWindow;
}

async function loadPopupURL() {
  // Forziamo SEMPRE la mini-UI locale (mai SERVER_URL)
  const devFile = path.resolve(process.cwd(), "src/renderer/mini-chat/index.html");
  const prodFile = path.join(__dirname, "../renderer/mini-chat/index.html");

  let targetFile = prodFile;
  if (is.dev && fs.existsSync(devFile)) {
    targetFile = devFile;
  } else if (!fs.existsSync(prodFile) && fs.existsSync(devFile)) {
    targetFile = devFile;
  }

  await popupWindow?.loadFile(targetFile);
}

function positionPopupNearCursor(win: BrowserWindow) {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const margin = 16;
  const { width, height } = win.getBounds();

  const x = Math.min(
    Math.max(cursor.x - Math.floor(width / 2), display.workArea.x + margin),
    display.workArea.x + display.workArea.width - width - margin
  );

  const y = Math.min(
    cursor.y + 20,
    display.workArea.y + display.workArea.height - height - margin
  );

  win.setPosition(x, y, false);
}

async function toggleQuickChat(nearCursor = true) {
  const win = createPopupWindow();

  if (win.isVisible()) {
    win.hide();
    return;
  }

  await loadPopupURL();

  if (nearCursor) {
    positionPopupNearCursor(win);
  } else {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const margin = 16;
    const { width, height } = win.getBounds();
    win.setPosition(
      display.workArea.x + display.workArea.width - width - margin,
      display.workArea.y + margin,
      false
    );
  }

  win.showInactive();
  win.focus();
}

// ------------------- Main Window -------------------
function createWindow(show = true): void {
  mainWindow = new BrowserWindow({
    width: 700,
    height: 500,
    minWidth: 400,
    minHeight: 400,
    icon: path.join(__dirname, "assets/icon.png"),
    show: false,
    titleBarStyle: process.platform === "win32" ? "default" : "hidden",
    trafficLightPosition: { x: 16, y: 16 },
    autoHideMenuBar: true,
    ...(process.platform === "win32" ? { frame: true } : {}),
    ...(process.platform === "linux" ? { icon } : {}),
    ...(process.platform !== "darwin" ? { titleBarOverlay: true } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });
  mainWindow.setIcon(icon);

  // Permessi getUserMedia (desktopCapturer)
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => callback({ video: sources[0], audio: "loopback" }));
    },
    { useSystemPicker: true }
  );

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  if (show) {
    mainWindow.on("ready-to-show", () => mainWindow?.show());
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openUrl(details.url);
    return { action: "deny" };
  });

  // Hotkey esistente: apre in browser o mostra la main window
  globalShortcut.register("Alt+CommandOrControl+O", () => {
    if (SERVER_URL) {
      openUrl(SERVER_URL);
    } else {
      mainWindow?.show();
      if (mainWindow?.isMinimized()) mainWindow?.restore();
      mainWindow?.focus();
    }
  });

  // Nuova hotkey: Quick Chat
  globalShortcut.register(QUICK_CHAT_HOTKEY, () => toggleQuickChat(true));

  const defaultMenu = Menu.getApplicationMenu();
  let menuTemplate = defaultMenu ? defaultMenu.items.map((i) => i) : [];
  menuTemplate.push({
    label: "Action",
    submenu: [
      {
        label: "Quick Chat",
        accelerator: QUICK_CHAT_HOTKEY,
        click: () => toggleQuickChat(false),
      },
      { type: "separator" },
      {
        label: "Uninstall",
        click: () => uninstallHandler(),
      },
      {
        label: "Reset",
        click: async () => await resetAppHandler(),
      },
    ],
  });
  const updatedMenu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(updatedMenu);

  // Tray
  const image = nativeImage.createFromPath(trayIconImage);
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  const trayMenu = Menu.buildFromTemplate([
    { label: "Show Controls", click: () => mainWindow?.show() },
    { label: "Quick Chat", click: () => toggleQuickChat(false) },
    { type: "separator" },
    {
      label: "Quit Open WebUI",
      accelerator: "CommandOrControl+Q",
      click: async () => {
        await stopServerHandler();
        isQuiting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip("Open WebUI");
  tray.setContextMenu(trayMenu);

  // Carica UI principale
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("close", (event) => {
    if (!(isQuiting ?? false)) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

const updateTrayMenu = (status: string, url: string | null) => {
  const trayMenuTemplate: Electron.MenuItemConstructorOptions[] = [
    { label: "Show Controls", click: () => mainWindow?.show() },
    { label: "Quick Chat", click: () => toggleQuickChat(false) },
    { type: "separator" },
    {
      label: status,
      enabled: !!url,
      click: () => url && openUrl(url),
    },
    ...(SERVER_STATUS === "started"
      ? [{
          label: "Copy Server URL",
          enabled: !!url,
          click: () => url && clipboard.writeText(url),
        }]
      : []),
    { type: "separator" },
    {
      label: "Quit Open WebUI",
      accelerator: "CommandOrControl+Q",
      click: () => {
        isQuiting = true;
        app.quit();
      },
    },
  ];

  const trayMenu = Menu.buildFromTemplate(trayMenuTemplate);
  tray?.setContextMenu(trayMenu);
};

// ------------------- Handlers Server/App -------------------
const uninstallHandler = async () => {
  try {
    await uninstallPython();
    if (mainWindow) {
      mainWindow.webContents.send("main:data", { type: "reload" });
    }
    new Notification({ title: "Open WebUI", body: "Uninstallation successful." }).show();
  } catch (error: any) {
    log.error("Uninstallation failed:", error);
    new Notification({ title: "Open WebUI", body: `Uninstallation failed: ${error.message}` }).show();
  }
};

const startServerHandler = async () => {
  await stopServerHandler();
  SERVER_STATUS = "starting";
  mainWindow?.webContents.send("main:data", { type: "status:server", data: SERVER_STATUS });

  try {
    CONFIG = await getConfig();
    ({ url: SERVER_URL, pid: SERVER_PID } = await startServer(
      CONFIG?.serveOnLocalNetwork ?? false,
      CONFIG?.port ?? null
    ));

    updateTrayMenu("Open WebUI: Starting...", null);
    log.info("Server started successfully:", SERVER_URL, SERVER_PID);
    SERVER_STATUS = "started";
    mainWindow?.webContents.send("main:data", { type: "status:server", data: SERVER_STATUS });

    checkUrlAndOpen(SERVER_URL, async () => {
      SERVER_REACHABLE = true;
      new Notification({
        title: "Open WebUI",
        body: "Open WebUI is now available and opened in your browser",
      }).show();

      updateTrayMenu(`Open WebUI: ${SERVER_URL}`, SERVER_URL);
      mainWindow?.webContents.send("main:data", { type: "server" });
    });

    return true;
  } catch (error) {
    log.error("Failed to start server:", error);
    SERVER_STATUS = "failed";
    mainWindow?.webContents.send("main:data", { type: "status:server", data: SERVER_STATUS });
    mainWindow?.webContents.send("main:log", `Failed to start server: ${error}`);
    updateTrayMenu("Open WebUI: Failed to Start", null);
    return false;
  }
};

const stopServerHandler = async () => {
  try {
    await stopAllServers();

    if (SERVER_STATUS) {
      SERVER_STATUS = "stopped";
      updateTrayMenu("Open WebUI: Stopped", null);
    }
    SERVER_REACHABLE = false;
    SERVER_URL = null;

    mainWindow?.webContents.send("main:data", { type: "status:server", data: SERVER_STATUS });
    return true;
  } catch (error) {
    log.error("Failed to stop server:", error);
    return false;
  }
};

const resetAppHandler = async () => {
  try {
    await stopServerHandler();
    SERVER_STATUS = null;

    await new Promise((resolve) => setTimeout(resolve, 1000));
    await resetApp();

    new Notification({ title: "Open WebUI", body: "Application has been reset successfully." }).show();
  } catch (error: any) {
    log.error("Failed to reset application:", error);
    new Notification({ title: "Open WebUI", body: `Failed to reset application: ${error.message}` }).show();
  }
};

// ------------------- Single Instance & Lifecycle -------------------
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.setAboutPanelOptions({
    applicationName: "Open WebUI",
    iconPath: icon,
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    website: "https://openwebui.com",
    copyright: `© ${new Date().getFullYear()} Open WebUI (Timothy Jaeryang Baek)`,
  });

  app.whenReady().then(async () => {
    CONFIG = await getConfig();
    log.info("Initial Config:", CONFIG);

    electronApp.setAppUserModelId("com.openwebui.desktop");

    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    // Ping di prova
    ipcMain.on("ping", () => log.info("pong"));

    // --- INFO per il popup (URL base + stato)
    ipcMain.handle("quickchat:info", async () => {
      let baseUrl = SERVER_URL || null;
      try {
        const cfg = CONFIG ?? (await getConfig());
        const port = cfg?.port ?? 8080;
        if (!baseUrl) baseUrl = `http://localhost:${port}`;
      } catch {
        if (!baseUrl) baseUrl = `http://localhost:8080`;
      }
      if (baseUrl?.startsWith("http://0.0.0.0")) {
        baseUrl = baseUrl.replace("http://0.0.0.0", "http://localhost");
      }
      return { baseUrl, status: SERVER_STATUS, reachable: SERVER_REACHABLE };
    });

    /**
     * quickchat:proxy
     * Proxy HTTP dal main → istanza Open WebUI, usando i cookie della sessione Electron.
     * Input: { method, path, headers?, body? (string), baseOverride? }
     * Output: { ok, status, headers, bodyText }
     */
    ipcMain.handle(
      "quickchat:proxy",
      async (_event, req: { method: string; path: string; headers?: any; body?: string; baseOverride?: string }) => {
        try {
          let base = req.baseOverride || SERVER_URL || `http://localhost:${(CONFIG?.port ?? 8080)}`;
          if (base.startsWith("http://0.0.0.0")) base = base.replace("http://0.0.0.0", "http://localhost");

          // Costruisci header Cookie dalla sessione corrente
          const cookieList = await session.defaultSession.cookies.get({ url: base });
          const cookieHeader = cookieList.map(c => `${c.name}=${c.value}`).join("; ");

          const headers = {
            ...(req.headers || {}),
            Cookie: cookieHeader,
          };

          const url = base.replace(/\/$/, "") + (req.path.startsWith("/") ? req.path : `/${req.path}`);
          const res = await fetch(url, {
            method: req.method || "GET",
            headers,
            body: req.body,
          });

          const bodyText = await res.text();
          const outHeaders: Record<string, string> = {};
          res.headers.forEach((v, k) => (outHeaders[k] = v));

          return { ok: res.ok, status: res.status, headers: outHeaders, bodyText };
        } catch (err: any) {
          return { ok: false, status: 0, headers: {}, bodyText: `Proxy error: ${err?.message || err}` };
        }
      }
    );

    // --- Cerotto per vecchi preload che emettono renderer:data (no-op)
    ipcMain.handle("renderer:data", async () => true);
    ipcMain.on("renderer:data", () => {});

    // --- Resto degli handler già presenti ---
    ipcMain.handle("get:version", async () => app.getVersion());

    ipcMain.handle("install:python", async () => {
      log.info("Installing package...");
      try {
        const res = await installPython();
        if (res) {
          mainWindow?.webContents.send("main:data", { type: "status:python", data: true });
          return true;
        }
        return false;
      } catch (error: any) {
        mainWindow?.webContents.send("main:data", { type: "status:python", data: false });
        mainWindow?.webContents.send("main:data", {
          type: "notification",
          data: { type: "error", message: error?.message ?? "Something went wrong :/" },
        });
        return false;
      }
    });

    ipcMain.handle("install:package", async () => {
      log.info("Installing package...");
      try {
        const res = await installPackage("open-webui");
        if (res) {
          mainWindow?.webContents.send("main:data", { type: "status:package", data: true });
        }
      } catch {
        mainWindow?.webContents.send("main:data", { type: "status:package", data: false });
      }
    });

    ipcMain.handle("status:python", async () => {
      return (await isPythonInstalled()) && (await isUvInstalled());
    });

    ipcMain.handle("status:package", async () => {
      const packageStatus = await isPackageInstalled("open-webui");
      log.info("Package Status:", packageStatus);
      return packageStatus;
    });

    ipcMain.handle("server:start", async () => await startServerHandler());
    ipcMain.handle("server:stop", async () => await stopServerHandler());
    ipcMain.handle("server:restart", async () => await startServerHandler());
    ipcMain.handle("server:logs", async () => (SERVER_PID ? await getServerLog(SERVER_PID) : []));
    ipcMain.handle("server:info", async () => ({
      url: SERVER_URL,
      status: SERVER_STATUS,
      pid: SERVER_PID,
      reachable: SERVER_REACHABLE,
    }));
    ipcMain.handle("status:server", async () => SERVER_STATUS);

    ipcMain.handle("app:info", async () => ({
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    }));

    ipcMain.handle("app:reset", async () => await resetAppHandler());
    ipcMain.handle("get:config", async () => await getConfig());
    ipcMain.handle("set:config", async (_event, config) => await setConfig(config));

    ipcMain.handle("open:browser", async (_event, { url }) => {
      if (!url) throw new Error("No URL provided to open in browser.");
      log.info("Opening URL in browser:", url);
      if (url.startsWith("http://0.0.0.0")) url = url.replace("http://0.0.0.0", "http://localhost");
      await openUrl(url);
    });

    ipcMain.handle("notification", async (_event, { title, body }) => {
      new Notification({ title, body }).show();
    });

    (async () => {
      if (isPackageInstalled("open-webui")) {
        if (CONFIG?.autoUpdate ?? true) {
          try {
            log.info("Checking for updates...");
            updateTrayMenu("Open WebUI: Checking for updates...", null);
            await installPackage("open-webui");
          } catch (error) {
            log.error("Failed to update package:", error);
          }
        }
        startServerHandler();
        createWindow(false);
      } else {
        createWindow();
      }
    })();

    app.on("activate", function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", async () => {
    isQuiting = true;
    await stopServerHandler();
    globalShortcut.unregisterAll();
    mainWindow = null;
    popupWindow = null;
    tray?.destroy();
    tray = null;
  });
}