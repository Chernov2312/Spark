const path = require('node:path');
const { app, BrowserWindow, Menu, desktopCapturer, dialog, shell } = require('electron');

const SPARK_ORIGIN = 'https://sparkwork.dpdns.org';
const externalProtocols = new Set(['https:', 'http:', 'mailto:', 'tel:']);

function isSparkUrl(url) {
  const parsed = URL.parse(url ?? '');
  return parsed?.protocol === 'https:' && parsed.origin === SPARK_ORIGIN && !parsed.username && !parsed.password;
}

function openInBrowser(value) {
  const url = URL.parse(value);
  if (url && externalProtocols.has(url.protocol) && !url.username && !url.password) {
    void shell.openExternal(url.href).catch(() => {});
  }
}

function configurePermissions(window) {
  const contents = window.webContents;
  const sparkSession = contents.session;
  const allowedMedia = new Set();

  sparkSession.setPermissionCheckHandler((page, permission, origin, details) => {
    if (page !== contents || !details.isMainFrame || !isSparkUrl(origin)) return false;
    if (permission === 'media') return allowedMedia.has(details.mediaType);
    return permission === 'notifications' || permission === 'display-capture';
  });

  sparkSession.setPermissionRequestHandler(async (page, permission, callback, details) => {
    if (page !== contents || !details.isMainFrame || !isSparkUrl(details.requestingUrl)) {
      return callback(false);
    }
    if (permission !== 'media') {
      return callback(permission === 'notifications' || permission === 'display-capture');
    }

    const types = details.mediaTypes ?? [];
    if (!types.length || types.some((type) => type !== 'audio' && type !== 'video')) {
      return callback(false);
    }
    const missing = types.filter((type) => !allowedMedia.has(type));
    if (!missing.length) return callback(true);

    const devices = missing.map((type) => type === 'audio' ? 'микрофону' : 'камере');
    const choice = await dialog.showMessageBox(window, {
      type: 'question',
      message: `Разрешить Spark доступ к ${devices.join(' и ')}?`,
      buttons: ['Разрешить', 'Отмена'],
      defaultId: 1,
      cancelId: 1,
    }).catch(() => null);
    const allowed = choice?.response === 0 && !window.isDestroyed() && isSparkUrl(contents.getURL());
    if (allowed) missing.forEach((type) => allowedMedia.add(type));
    callback(allowed);
  });

  sparkSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (request.frame !== contents.mainFrame || !isSparkUrl(request.securityOrigin) || !request.userGesture) {
      return callback({});
    }
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 },
      });
      if (!sources.length || window.isDestroyed()) return callback({});
      const { response } = await dialog.showMessageBox(window, {
        type: 'question',
        message: 'Выберите экран или окно для показа',
        buttons: ['Отмена', ...sources.map(({ name }) => name.replaceAll('&', '&&'))],
        cancelId: 0,
      });
      const source = sources[response - 1];
      callback(source && !window.isDestroyed() && request.frame === contents.mainFrame ? { video: source } : {});
    } catch {
      callback({});
    }
  }, { useSystemPicker: true });
}

async function createWindow() {
  const window = new BrowserWindow({
    title: 'Spark',
    width: 1240,
    height: 840,
    minWidth: 480,
    minHeight: 560,
    backgroundColor: '#0b0d12',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.webContents.on('will-navigate', (event) => {
    if (isSparkUrl(event.url)) return;
    event.preventDefault();
    openInBrowser(event.url);
  });
  window.webContents.on('will-redirect', (event) => {
    if (event.isMainFrame && !isSparkUrl(event.url)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: 'deny' };
  });
  configurePermissions(window);

  while (!window.isDestroyed()) {
    try {
      await window.loadURL(`${SPARK_ORIGIN}/chats`);
      return;
    } catch {
      if (window.isDestroyed()) return;
      const { response } = await dialog.showMessageBox(window, {
        type: 'error',
        message: 'Не удалось подключиться к Spark',
        detail: 'Проверьте подключение к интернету и попробуйте снова.',
        buttons: ['Повторить', 'Закрыть'],
        cancelId: 1,
      });
      if (response === 1) window.close();
    }
  }
}

app.setAppUserModelId('org.sparkwork.messenger');
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on('window-all-closed', () => app.quit());
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Правка', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'Вид', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    ]));
    return createWindow();
  });
}
