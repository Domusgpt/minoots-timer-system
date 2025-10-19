const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let tray;
let window;

function createWindow() {
  window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
    },
  });

  const dashboardUrl = process.env.MINOOTS_DASHBOARD_URL || 'https://dashboard.minoots.dev';
  window.loadURL(dashboardUrl);
}

function createTray() {
  const iconPath = path.join(__dirname, 'icons', 'tray.png');
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  }

  if (!icon || icon.isEmpty()) {
    tray = new Tray(nativeImage.createEmpty());
  } else {
    tray = new Tray(icon);
  }
  tray.setToolTip('MINOOTS Timer Control Center');
  tray.on('click', () => {
    if (window) {
      window.show();
      window.focus();
    }
  });

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show Dashboard',
        click() {
          if (window) {
            window.show();
          } else {
            createWindow();
          }
        },
      },
      {
        label: 'Quit',
        click() {
          app.quit();
        },
      },
    ]),
  );
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
