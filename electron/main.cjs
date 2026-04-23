const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

let mainWindow;
let serverProcess;
let serverUrl = 'http://localhost:3000';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Tmesh',
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadURL(serverUrl);
}

function serverEntryPath() {
  return path.join(app.getAppPath(), 'dist', 'server.js');
}

function extractServerUrl(line) {
  const match = line.match(/http:\/\/localhost:(\d+)/);
  if (match) {
    serverUrl = `http://localhost:${match[1]}`;
  }
}

function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const check = () => {
      const url = serverUrl;
      const req = http.get(`${url}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });

      req.on('error', retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() >= deadline) {
        reject(new Error(`Tmesh server did not start at ${serverUrl}`));
        return;
      }
      setTimeout(check, 300);
    };

    check();
  });
}

async function startServer() {
  const userDataDir = app.getPath('userData');

  serverProcess = spawn(process.execPath, [serverEntryPath()], {
    cwd: userDataDir,
    env: {
      ...process.env,
      AIRCHAT_RUNTIME_DIR: path.join(app.getAppPath(), 'dist'),
      AIRCHAT_UPLOADS_DIR: userDataDir,
      NODE_ENV: 'production',
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', (chunk) => {
    chunk.toString().split(/\r?\n/).forEach(extractServerUrl);
  });

  serverProcess.stderr.on('data', (chunk) => {
    console.error(chunk.toString());
  });

  serverProcess.on('exit', (code) => {
    if (code !== 0 && mainWindow) {
      dialog.showErrorBox('Tmesh 已退出', `本地服务已停止，退出码：${code ?? 'unknown'}`);
    }
  });

  await waitForServer();
}

app.whenReady().then(async () => {
  try {
    await startServer();
    createWindow();
  } catch (error) {
    dialog.showErrorBox('Tmesh 启动失败', error instanceof Error ? error.message : String(error));
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverProcess) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});
