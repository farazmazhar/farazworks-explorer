const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const ProviderManager = require('./src/providers/ProviderManager')
const LocalProvider = require('./src/providers/LocalProvider')
const DbfsProvider = require('./src/providers/DbfsProvider')
const fs = require('fs')
const os = require('os')

const providerManager = new ProviderManager()

let configPath = '';

function initConfigPath() {
  if (!configPath) {
    if (app.isPackaged) {
      configPath = path.join(path.dirname(app.getPath('exe')), 'providers.json');
    } else {
      configPath = path.join(__dirname, 'providers.json');
    }
  }
}

function loadProviders() {
  initConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      data.forEach(conf => {
        if (conf.type === 'local') {
          providerManager.registerProvider(new LocalProvider(conf.id, conf.name, conf.rootPath));
        } else if (conf.type === 'dbfs') {
          providerManager.registerProvider(new DbfsProvider(conf.id, conf.name, conf.host, conf.token));
        }
      });
    } catch (e) {
      console.error('Failed to load providers.json', e);
    }
  }

  // Ensure default local provider exists
  try {
    providerManager.getProvider('local');
  } catch (e) {
    providerManager.registerProvider(new LocalProvider('local', 'Local Drive'));
  }
}

function saveProviders() {
  initConfigPath();
  const providers = providerManager.getProviderInstances().map(p => p.serialize());
  try {
    fs.writeFileSync(configPath, JSON.stringify(providers, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save providers.json', e);
  }
}


let mainWindow;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.loadFile('index.html')
}

app.whenReady().then(() => {
  loadProviders();

  // Setup IPC Handlers
  ipcMain.handle('get-providers', () => providerManager.getAllProviders())
  
  ipcMain.handle('add-provider', (event, type, config) => {
    const id = config.id || `${type}_${Date.now()}`;
    if (type === 'local') {
      const p = new LocalProvider(id, config.name, config.rootPath);
      providerManager.registerProvider(p);
      saveProviders();
      return { success: true, id };
    } else if (type === 'dbfs') {
      const p = new DbfsProvider(id, config.name, config.host, config.token);
      providerManager.registerProvider(p);
      saveProviders();
      return { success: true, id };
    }
    return { success: false, error: 'Unknown provider type' };
  })

  ipcMain.handle('get-dbfs-profiles', () => {
    const cfgPath = path.join(os.homedir(), '.databrickscfg');
    const profiles = [];
    if (fs.existsSync(cfgPath)) {
      const content = fs.readFileSync(cfgPath, 'utf8');
      let currentProfile = null;
      let host = null;
      let token = null;

      for (let line of content.split('\n')) {
        line = line.trim();
        if (!line || line.startsWith('#')) continue;
        
        if (line.startsWith('[') && line.endsWith(']')) {
          if (currentProfile && host && token) {
            profiles.push({ name: currentProfile, host, token });
          }
          currentProfile = line.slice(1, -1);
          host = null;
          token = null;
        } else if (currentProfile && line.includes('=')) {
          const [key, ...vals] = line.split('=');
          const val = vals.join('=').trim();
          if (key.trim() === 'host') host = val;
          if (key.trim() === 'token') token = val;
        }
      }
      if (currentProfile && host && token) {
        profiles.push({ name: currentProfile, host, token });
      }
    }
    return profiles;
  })

  ipcMain.handle('remove-provider', (event, providerId) => {
    const success = providerManager.removeProvider(providerId);
    if (success) saveProviders();
    return success;
  })

  ipcMain.handle('list-files', async (event, providerId, targetPath) => {
    return await providerManager.listFiles(providerId, targetPath)
  })

  ipcMain.handle('delete', async (event, providerId, path) => {
    return await providerManager.delete(providerId, path)
  })

  ipcMain.handle('rename', async (event, providerId, oldPath, newName) => {
    return await providerManager.rename(providerId, oldPath, newName)
  })

  ipcMain.handle('copy', async (event, srcProviderId, destProviderId, srcPath, destDir) => {
    const onProgress = (data) => {
      mainWindow.webContents.send('progress-update', data);
    }
    return await providerManager.copy(srcProviderId, destProviderId, srcPath, destDir, onProgress)
  })

  ipcMain.handle('move', async (event, srcProviderId, destProviderId, srcPath, destDir) => {
    return await providerManager.move(srcProviderId, destProviderId, srcPath, destDir)
  })

  ipcMain.handle('mkdir', async (event, providerId, targetDir, folderName) => {
    return await providerManager.mkdir(providerId, targetDir, folderName)
  })

  // Dialog Handlers
  ipcMain.handle('show-open-dialog', async (event, options) => {
    return await dialog.showOpenDialog(mainWindow, options);
  })

  ipcMain.handle('show-save-dialog', async (event, options) => {
    return await dialog.showSaveDialog(mainWindow, options);
  })

  // Drag and Drop
  ipcMain.on('ondragstart', (event, filePath) => {
    event.sender.startDrag({
      file: filePath,
      icon: path.join(__dirname, 'icon.png') // Ideally we should create a dummy icon or ignore it.
      // We will create a small transparent icon or default icon.
    })
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})