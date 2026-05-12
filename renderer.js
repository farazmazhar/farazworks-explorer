// SVG Icons (loaded dynamically)
const icons = {
  folder: '',
  file: '',
  chevronRight: '',
  chevronDown: '',
  provider: '',
  dbfs: ''
};

async function loadIcons() {
  const iconNames = Object.keys(icons);
  for (const name of iconNames) {
    try {
      const res = await fetch(`icons/${name}.svg`);
      if (res.ok) {
        icons[name] = await res.text();
      }
    } catch (e) {
      console.error(`Failed to load icon: ${name}`, e);
    }
  }
}

// State
let currentProviderId = null;
let currentPath = '';
let selectedItem = null;
let clipboard = null; // { action: 'copy', path: '...', providerId: '...' }

// Elements
const treeRootEl = document.getElementById('tree-root');
const fileTbodyEl = document.getElementById('file-tbody');
const breadcrumbsEl = document.getElementById('breadcrumbs');
const btnAddProvider = document.getElementById('btn-add-provider');
const mainContentEl = document.getElementById('main-content');

// Action Buttons
const btnUpload = document.getElementById('btn-upload');
const btnDownload = document.getElementById('btn-download');
const btnNewFolder = document.getElementById('btn-new-folder');
const btnCut = document.getElementById('btn-cut');
const btnCopy = document.getElementById('btn-copy');
const btnPaste = document.getElementById('btn-paste');
const btnRename = document.getElementById('btn-rename');
const btnDelete = document.getElementById('btn-delete');

// Modal Elements
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalInput = document.getElementById('modal-input');
const modalInputLabel = document.getElementById('modal-input-label');
const modalProviderTypeContainer = document.getElementById('modal-provider-type-container');
const modalSelectType = document.getElementById('modal-select-type');
const modalDbfsConfig = document.getElementById('modal-dbfs-config');
const dbfsAuthRadios = document.getElementsByName('dbfs-auth-type');
const dbfsProfileSection = document.getElementById('dbfs-profile-section');
const modalDbfsProfile = document.getElementById('modal-dbfs-profile');
const dbfsManualSection = document.getElementById('dbfs-manual-section');
const modalDbfsHost = document.getElementById('modal-dbfs-host');
const modalDbfsToken = document.getElementById('modal-dbfs-token');
const modalCancel = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');
let modalResolve = null;
let dbfsProfiles = [];

// Context Menu Elements
const contextMenu = document.getElementById('context-menu');
const ctxDownload = document.getElementById('ctx-download');
const ctxCut = document.getElementById('ctx-cut');
const ctxCopy = document.getElementById('ctx-copy');
const ctxPaste = document.getElementById('ctx-paste');
const ctxRename = document.getElementById('ctx-rename');
const ctxDelete = document.getElementById('ctx-delete');

// Toast Elements
const toastContainer = document.getElementById('toast-container');
const toastMessage = document.getElementById('toast-message');

// Formatter utility
function formatBytes(bytes) {
  if (bytes === 0) return '';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Initialize
async function init() {
  await loadIcons();
  await refreshProviders();
  setupEventListeners();

  // Listen for progress updates
  window.explorerAPI.onProgressUpdate((data) => {
    if (data.status === 'copying') {
      showProgress(`Copying ${data.file}...`);
    } else if (data.status === 'completed') {
      hideProgress();
    }
  });
}

async function refreshProviders() {
  const providers = await window.explorerAPI.getProviders();
  renderProviderTree(providers);
  if (!currentProviderId && providers.length > 0) {
    selectProvider(providers[0].id);
  }
}

function showProgress(message) {
  toastMessage.innerText = message;
  toastContainer.style.display = 'flex';
}

function hideProgress() {
  toastContainer.style.display = 'none';
}

function setupEventListeners() {
  // Add Provider
  btnAddProvider.addEventListener('click', async () => {
    const result = await promptUser('Provider Name:', 'My Local Drive', true);
    if (result && result.value) {
      if (result.type === 'local') {
        await window.explorerAPI.addProvider('local', { name: result.value });
        await refreshProviders();
      } else if (result.type === 'dbfs') {
        let config = { name: result.value };
        if (result.dbfs.authType === 'profile') {
          const profile = dbfsProfiles.find(p => p.name === result.dbfs.profileName);
          if (profile) {
            config.host = profile.host;
            config.token = profile.token;
          } else {
            alert('Selected profile not found.');
            return;
          }
        } else {
          config.host = result.dbfs.host;
          config.token = result.dbfs.token;
        }
        await window.explorerAPI.addProvider('dbfs', config);
        await refreshProviders();
      }
    }
  });

  // Handle modal dynamic UI
  modalSelectType.addEventListener('change', () => {
    if (modalSelectType.value === 'dbfs') {
      modalDbfsConfig.style.display = 'block';
    } else {
      modalDbfsConfig.style.display = 'none';
    }
  });

  Array.from(dbfsAuthRadios).forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'profile') {
        dbfsProfileSection.style.display = 'block';
        dbfsManualSection.style.display = 'none';
      } else {
        dbfsProfileSection.style.display = 'none';
        dbfsManualSection.style.display = 'block';
      }
    });
  });

  // Action Ribbon
  btnUpload.addEventListener('click', handleUploadClick);
  btnDownload.addEventListener('click', handleDownload);
  btnNewFolder.addEventListener('click', handleNewFolder);
  btnCut.addEventListener('click', handleCut);
  btnCopy.addEventListener('click', handleCopy);
  btnPaste.addEventListener('click', handlePaste);
  btnRename.addEventListener('click', handleRename);
  btnDelete.addEventListener('click', handleDelete);

  // Context Menu
  ctxDownload.addEventListener('click', () => { hideContextMenu(); handleDownload(); });
  ctxCut.addEventListener('click', () => { hideContextMenu(); handleCut(); });
  ctxCopy.addEventListener('click', () => { hideContextMenu(); handleCopy(); });
  ctxPaste.addEventListener('click', () => { hideContextMenu(); handlePaste(); });
  ctxRename.addEventListener('click', () => { hideContextMenu(); handleRename(); });
  ctxDelete.addEventListener('click', () => { hideContextMenu(); handleDelete(); });

  // Hide context menu on click anywhere
  window.addEventListener('click', (e) => {
    hideContextMenu();
  });
  window.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('tr.file-row')) {
      hideContextMenu();
    }
  });

  // Modal
  modalCancel.addEventListener('click', () => closeModal(null));
  modalConfirm.addEventListener('click', () => closeModal(modalInput.value));

  // Drag and drop in main content
  mainContentEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  mainContentEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!currentProviderId) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      for (const file of files) {
        if (file.path) { // file.path is available in Electron
          await window.explorerAPI.copy('local', currentProviderId, file.path, currentPath);
        }
      }
      loadFiles();
    }
  });
}

async function handleUploadClick() {
  const result = await window.explorerAPI.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
  if (!result.canceled && result.filePaths.length > 0) {
    for (const filePath of result.filePaths) {
      await window.explorerAPI.copy('local', currentProviderId, filePath, currentPath);
    }
    loadFiles();
  }
}

async function handleDownload() {
  if (!selectedItem || selectedItem.isDir) return;
  const result = await window.explorerAPI.showSaveDialog({ defaultPath: selectedItem.name });
  if (!result.canceled && result.filePath) {
    const destDir = result.filePath.substring(0, result.filePath.lastIndexOf(selectedItem.name.includes('\\') ? '\\' : '/')); 
    if (destDir) {
      await window.explorerAPI.copy(currentProviderId, 'local', selectedItem.path, destDir);
    }
  }
}

async function handleNewFolder() {
  const folderName = await promptUser('New Folder Name:', 'New Folder');
  if (folderName) {
    await window.explorerAPI.mkdir(currentProviderId, currentPath, folderName);
    loadFiles();
  }
}

function handleCut() {
  if (selectedItem) {
    clipboard = { action: 'cut', path: selectedItem.path, providerId: currentProviderId };
    updateActionRibbon();
  }
}

function handleCopy() {
  if (selectedItem) {
    clipboard = { action: 'copy', path: selectedItem.path, providerId: currentProviderId };
    updateActionRibbon();
  }
}

async function handlePaste() {
  if (clipboard) {
    if (clipboard.action === 'copy') {
      await window.explorerAPI.copy(clipboard.providerId, currentProviderId, clipboard.path, currentPath);
    } else if (clipboard.action === 'cut') {
      await window.explorerAPI.move(clipboard.providerId, currentProviderId, clipboard.path, currentPath);
      clipboard = null; // clear clipboard after move
    }
    updateActionRibbon();
    loadFiles();
  }
}

async function handleRename() {
  if (selectedItem) {
    const newName = await promptUser('Rename item:', selectedItem.name);
    if (newName && newName !== selectedItem.name) {
      await window.explorerAPI.rename(currentProviderId, selectedItem.path, newName);
      loadFiles();
    }
  }
}

async function handleDelete() {
  if (selectedItem) {
    if (confirm(`Are you sure you want to delete ${selectedItem.name}?`)) {
      await window.explorerAPI.delete(currentProviderId, selectedItem.path);
      loadFiles();
    }
  }
}

function showContextMenu(x, y) {
  contextMenu.style.display = 'flex';
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  
  // Update state
  ctxDownload.style.display = (!selectedItem || selectedItem.isDir) ? 'none' : 'block';
  ctxPaste.style.display = clipboard ? 'block' : 'none';
}

function hideContextMenu() {
  contextMenu.style.display = 'none';
}

function promptUser(title, defaultValue = '', showTypeDropdown = false) {
  return new Promise(async (resolve) => {
    modalTitle.innerText = title;
    modalInput.value = defaultValue;
    modalDbfsHost.value = '';
    modalDbfsToken.value = '';
    
    if (showTypeDropdown) {
      modalProviderTypeContainer.style.display = 'block';
      modalSelectType.value = 'local';
      modalDbfsConfig.style.display = 'none';
      
      // Load DBFS profiles
      dbfsProfiles = await window.explorerAPI.getDbfsProfiles();
      modalDbfsProfile.innerHTML = '';
      if (dbfsProfiles.length > 0) {
        dbfsProfiles.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.name;
          opt.innerText = p.name;
          modalDbfsProfile.appendChild(opt);
        });
      } else {
        const opt = document.createElement('option');
        opt.value = '';
        opt.innerText = 'No profiles found';
        modalDbfsProfile.appendChild(opt);
      }
    } else {
      modalProviderTypeContainer.style.display = 'none';
      modalDbfsConfig.style.display = 'none';
    }
    modalOverlay.style.display = 'flex';
    modalInput.focus();
    modalInput.select();
    modalResolve = resolve;
  });
}

function closeModal(value) {
  modalOverlay.style.display = 'none';
  if (modalResolve) {
    if (value !== null && modalProviderTypeContainer.style.display === 'block') {
      const dbfsData = {};
      if (modalSelectType.value === 'dbfs') {
        dbfsData.authType = document.querySelector('input[name="dbfs-auth-type"]:checked').value;
        dbfsData.profileName = modalDbfsProfile.value;
        dbfsData.host = modalDbfsHost.value;
        dbfsData.token = modalDbfsToken.value;
      }
      modalResolve({ value, type: modalSelectType.value, dbfs: dbfsData });
    } else {
      modalResolve(value);
    }
    modalResolve = null;
  }
}

// Tree Navigator (Providers at root)
function renderProviderTree(providers) {
  treeRootEl.innerHTML = '';
  providers.forEach(provider => {
    const li = document.createElement('li');
    li.className = 'tree-item';
    
    // Check if it is a dbfs provider to use the dbfs icon
    const iconToUse = provider.id.startsWith('dbfs') ? icons.dbfs : icons.provider;

    const row = document.createElement('div');
    row.className = 'tree-row';
    row.innerHTML = `
      <div class="tree-toggle">${icons.chevronRight}</div>
      <div class="tree-icon">${iconToUse}</div>
      <span style="flex:1;">${provider.name}</span>
      ${provider.id !== 'local' ? `<button class="btn-icon btn-remove-provider" title="Remove Provider" style="padding: 2px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>` : ''}
    `;

    const childrenUl = document.createElement('ul');
    childrenUl.className = 'tree-children';
    let loaded = false;

    // Remove provider logic
    const removeBtn = row.querySelector('.btn-remove-provider');
    if (removeBtn) {
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Remove provider ${provider.name}?`)) {
          await window.explorerAPI.removeProvider(provider.id);
          if (currentProviderId === provider.id) currentProviderId = null;
          await refreshProviders();
        }
      });
    }

    row.querySelector('.tree-toggle').addEventListener('click', async (e) => {
      e.stopPropagation();
      childrenUl.classList.toggle('open');
      const isOpen = childrenUl.classList.contains('open');
      row.querySelector('.tree-toggle').innerHTML = isOpen ? icons.chevronDown : icons.chevronRight;
      
      if (isOpen && !loaded) {
        loaded = true;
        await loadTreeDirectory(provider.id, '', childrenUl); 
      }
    });

    row.addEventListener('click', () => {
      selectProvider(provider.id);
    });

    li.appendChild(row);
    li.appendChild(childrenUl);
    treeRootEl.appendChild(li);
  });
}

async function loadTreeDirectory(providerId, dirPath, containerEl) {
  try {
    containerEl.innerHTML = '<li style="padding-left:20px; color:#888;">Loading...</li>';
    const result = await window.explorerAPI.listFiles(providerId, dirPath);
    containerEl.innerHTML = '';
    
    const dirs = result.items.filter(item => item.isDir);
    if (dirs.length === 0) {
       containerEl.innerHTML = '<li style="padding-left:20px; color:#888; font-size:11px;">(Empty)</li>';
       return;
    }

    dirs.forEach(dir => {
      const li = document.createElement('li');
      li.className = 'tree-item';
      
      const row = document.createElement('div');
      row.className = 'tree-row';
      row.innerHTML = `
        <div class="tree-toggle">${icons.chevronRight}</div>
        <div class="tree-icon">${icons.folder}</div>
        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; width: 100%;">${dir.name}</span>
      `;
      row.title = dir.name;

      const childrenUl = document.createElement('ul');
      childrenUl.className = 'tree-children';
      let loaded = false;

      row.querySelector('.tree-toggle').addEventListener('click', async (e) => {
        e.stopPropagation();
        childrenUl.classList.toggle('open');
        const isOpen = childrenUl.classList.contains('open');
        row.querySelector('.tree-toggle').innerHTML = isOpen ? icons.chevronDown : icons.chevronRight;
        
        if (isOpen && !loaded) {
          loaded = true;
          await loadTreeDirectory(providerId, dir.path, childrenUl);
        }
      });

      row.addEventListener('click', () => {
        if (currentProviderId !== providerId) {
          currentProviderId = providerId;
        }
        currentPath = dir.path;
        loadFiles();
      });

      li.appendChild(row);
      li.appendChild(childrenUl);
      containerEl.appendChild(li);
    });
  } catch (err) {
    containerEl.innerHTML = '<li style="padding-left:20px; color:red;">Error</li>';
  }
}

// Select Provider for main view
async function selectProvider(providerId) {
  currentProviderId = providerId;
  currentPath = '';
  await loadFiles();
}

// Load Files into Main Table
async function loadFiles() {
  selectedItem = null;
  updateActionRibbon();

  try {
    const result = await window.explorerAPI.listFiles(currentProviderId, currentPath);
    currentPath = result.path; 
    
    renderBreadcrumbs();
    renderFilesTable(result.items);
  } catch (error) {
    console.error('Failed to load files:', error);
    fileTbodyEl.innerHTML = `<tr><td colspan="4" style="color: #ff6b6b; text-align:center;">Error loading directory contents.</td></tr>`;
  }
}

function renderFilesTable(items) {
  fileTbodyEl.innerHTML = '';
  
  if (items.length === 0) {
    fileTbodyEl.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--text-muted); padding: 20px;">Folder is empty.</td></tr>`;
    return;
  }

  items.forEach(item => {
    const tr = document.createElement('tr');
    tr.className = 'file-row';
    // Make row draggable
    tr.setAttribute('draggable', 'true');
    
    const typeStr = item.isDir ? 'File folder' : 'File';
    const dateStr = item.lastModified ? new Date(item.lastModified).toLocaleString() : '';

    tr.innerHTML = `
      <td>
        <div class="td-name">
          ${item.isDir ? icons.folder : icons.file}
          <span>${item.name}</span>
        </div>
      </td>
      <td>${formatBytes(item.size)}</td>
      <td>${typeStr}</td>
      <td>${dateStr}</td>
    `;

    // Click to select
    tr.addEventListener('click', (e) => {
      e.stopPropagation();
      Array.from(fileTbodyEl.children).forEach(row => row.classList.remove('selected'));
      tr.classList.add('selected');
      selectedItem = item;
      updateActionRibbon();
    });

    // Right click for context menu
    tr.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Select the row first
      Array.from(fileTbodyEl.children).forEach(row => row.classList.remove('selected'));
      tr.classList.add('selected');
      selectedItem = item;
      updateActionRibbon();
      
      showContextMenu(e.pageX, e.pageY);
    });

    // Double click to enter folder
    tr.addEventListener('dblclick', () => {
      if (item.isDir) {
        currentPath = item.path;
        loadFiles();
      }
    });

    // Drag start for downloading
    tr.addEventListener('dragstart', (e) => {
      e.preventDefault(); // Required for startDrag in electron
      window.explorerAPI.startDrag(item.path);
    });

    fileTbodyEl.appendChild(tr);
  });
}

function renderBreadcrumbs() {
  breadcrumbsEl.innerHTML = '';
  const separator = currentPath.includes('\\') ? '\\' : '/';
  const parts = currentPath.split(separator).filter(Boolean);
  
  if (parts.length === 0) {
    breadcrumbsEl.innerHTML = `<span class="crumb" onclick="navigateToPath('')">/</span>`;
    return;
  }

  let cumulativePath = currentPath.startsWith('/') ? '/' : '';

  if (currentPath.startsWith('/')) {
    breadcrumbsEl.innerHTML += `<span class="crumb" onclick="navigateToPath('/')">root</span><span class="separator">›</span>`;
  }

  parts.forEach((part, index) => {
    cumulativePath += part + (index < parts.length - 1 ? separator : '');
    const isLast = index === parts.length - 1;
    
    if (isLast) {
      breadcrumbsEl.innerHTML += `<span>${part}</span>`;
    } else {
      breadcrumbsEl.innerHTML += `<span class="crumb" onclick="navigateToPath('${cumulativePath.replace(/\\/g, '\\\\')}')">${part}</span><span class="separator">›</span>`;
    }
  });
}

window.navigateToPath = function(path) {
  currentPath = path;
  loadFiles();
}

function updateActionRibbon() {
  btnDownload.disabled = !selectedItem || selectedItem.isDir;
  btnCut.disabled = !selectedItem;
  btnCopy.disabled = !selectedItem;
  btnRename.disabled = !selectedItem;
  btnDelete.disabled = !selectedItem;
  
  btnPaste.disabled = !clipboard;
}

// Start app
init();
