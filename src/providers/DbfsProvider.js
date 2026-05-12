const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

class DbfsProvider {
  constructor(id, name, host, token) {
    this.id = id;
    this.name = name;
    this.host = host.replace(/\/$/, '');
    this.token = token;
  }

  getId() { return this.id; }
  getName() { return this.name; }

  serialize() {
    return { type: 'dbfs', id: this.id, name: this.name, host: this.host, token: this.token };
  }

  async _request(method, endpoint, body = null) {
    const url = `${this.host}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.token}`
    };

    const options = { method, headers };
    if (body) {
      if (method !== 'GET') {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
    }

    const response = await fetch(url, options);
    const text = await response.text();
    
    if (!response.ok) {
      throw new Error(`DBFS API Error (${response.status}): ${text}`);
    }

    return text ? JSON.parse(text) : null;
  }

  _formatDate(ms) {
    return ms ? new Date(ms).toISOString() : '';
  }

  async list(targetPath) {
    if (!targetPath || targetPath === '') targetPath = '/';
    try {
      const result = await this._request('GET', `/api/2.0/dbfs/list?path=${encodeURIComponent(targetPath)}`);
      
      const files = result.files || [];
      const items = files.map(f => ({
        name: path.posix.basename(f.path),
        path: f.path,
        isDir: f.is_dir,
        size: f.file_size || 0,
        lastModified: f.modification_time
      }));

      items.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });

      return {
        path: targetPath,
        items: items
      };
    } catch (err) {
      // If error is RESOURCE_DOES_NOT_EXIST and it's root, return empty (clean workspace)
      if (err.message.includes('RESOURCE_DOES_NOT_EXIST') && targetPath === '/') {
        return { path: '/', items: [] };
      }
      throw err;
    }
  }

  async _getUniquePath(destPath) {
    try {
      // Trying to list the specific file path will throw if it's a file
      // Instead, list its parent directory and check for existence
      const dir = path.posix.dirname(destPath);
      const baseName = path.posix.basename(destPath);
      const dirRes = await this.list(dir);
      const exists = dirRes.items.some(i => i.name === baseName);
      if (!exists) return destPath;
    } catch (err) {
      return destPath; // Parent dir doesn't exist, so path is unique
    }

    const ext = path.posix.extname(destPath);
    const base = path.posix.basename(destPath, ext);
    const dir = path.posix.dirname(destPath);
    
    let counter = 1;
    while (true) {
      const newPath = path.posix.join(dir, `${base}-${counter}${ext}`);
      try {
        const dirRes = await this.list(dir);
        const exists = dirRes.items.some(i => i.name === path.posix.basename(newPath));
        if (!exists) return newPath;
        counter++;
      } catch (err) {
        return newPath;
      }
    }
  }

  async delete(targetPath) {
    await this._request('POST', `/api/2.0/dbfs/delete`, { path: targetPath, recursive: true });
  }

  async rename(oldPath, newName) {
    const dir = path.posix.dirname(oldPath);
    const newPath = path.posix.join(dir, newName);
    await this._request('POST', `/api/2.0/dbfs/move`, { source_path: oldPath, destination_path: newPath });
    return newPath;
  }

  async move(srcPath, destDir) {
    const fileName = path.posix.basename(srcPath);
    let newPath = path.posix.join(destDir, fileName);
    newPath = await this._getUniquePath(newPath);
    await this._request('POST', `/api/2.0/dbfs/move`, { source_path: srcPath, destination_path: newPath });
    return newPath;
  }

  async mkdir(targetDir, folderName) {
    let newPath = path.posix.join(targetDir, folderName);
    newPath = await this._getUniquePath(newPath);
    await this._request('POST', `/api/2.0/dbfs/mkdirs`, { path: newPath });
    return newPath;
  }

  // Called when uploading from Local to DBFS
  async upload(localSrcPath, destDir, onProgress) {
    const fileName = path.basename(localSrcPath);
    let dbfsDestPath = path.posix.join(destDir || '/', fileName);
    dbfsDestPath = await this._getUniquePath(dbfsDestPath);
    
    const stats = await fsPromises.stat(localSrcPath);
    const totalSize = stats.size;
    let uploadedBytes = 0;

    // Create file
    const createRes = await this._request('POST', `/api/2.0/dbfs/create`, { path: dbfsDestPath, overwrite: true });
    const handle = createRes.handle;

    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(localSrcPath, { highWaterMark: 1024 * 1024 }); // 1MB chunks

      readStream.on('data', async (chunk) => {
        readStream.pause();
        try {
          await this._request('POST', `/api/2.0/dbfs/add-block`, {
            handle: handle,
            data: chunk.toString('base64')
          });
          uploadedBytes += chunk.length;
          if (onProgress) {
            onProgress({ status: 'copying', file: fileName, progress: Math.round((uploadedBytes / totalSize) * 100) });
          }
          readStream.resume();
        } catch (err) {
          reject(err);
        }
      });

      readStream.on('end', async () => {
        try {
          await this._request('POST', `/api/2.0/dbfs/close`, { handle: handle });
          if (onProgress) onProgress({ status: 'completed', file: fileName, progress: 100 });
          resolve(dbfsDestPath);
        } catch (err) {
          reject(err);
        }
      });

      readStream.on('error', reject);
    });
  }

  // Called when downloading from DBFS to Local
  async download(dbfsSrcPath, localDestDir, onProgress) {
    const fileName = path.posix.basename(dbfsSrcPath);
    const localDestPath = path.join(localDestDir, fileName);
    
    // First, list to get the file size (since we can't easily stat single files without list)
    let totalSize = 0;
    try {
      const dirRes = await this.list(path.posix.dirname(dbfsSrcPath));
      const fItem = dirRes.items.find(i => i.name === fileName);
      if (fItem) totalSize = fItem.size;
    } catch (e) {
      // Ignored, progress will just be indeterminate if we can't get size
    }

    let offset = 0;
    const length = 1024 * 1024; // 1MB

    const writeStream = fs.createWriteStream(localDestPath);

    while (true) {
      const res = await this._request('GET', `/api/2.0/dbfs/read?path=${encodeURIComponent(dbfsSrcPath)}&offset=${offset}&length=${length}`);
      
      if (res.data) {
        const buffer = Buffer.from(res.data, 'base64');
        writeStream.write(buffer);
        offset += res.bytes_read;
        
        if (onProgress) {
          const progress = totalSize > 0 ? Math.round((offset / totalSize) * 100) : -1;
          onProgress({ status: 'copying', file: fileName, progress });
        }
      }

      if (res.bytes_read < length) {
        // EOF
        break;
      }
    }

    writeStream.end();
    if (onProgress) onProgress({ status: 'completed', file: fileName, progress: 100 });
    return localDestPath;
  }
  
  // NOTE: copy inside DBFS isn't natively supported via REST without reading and writing back.
  async copy(srcPath, destDir, onProgress) {
    const fileName = path.posix.basename(srcPath);
    let destPath = path.posix.join(destDir, fileName);
    destPath = await this._getUniquePath(destPath);
    
    // 1. Get size
    let totalSize = 0;
    try {
      const dirRes = await this.list(path.posix.dirname(srcPath));
      const fItem = dirRes.items.find(i => i.name === fileName);
      if (fItem) totalSize = fItem.size;
    } catch (e) {}

    // 2. Create destination file
    const createRes = await this._request('POST', `/api/2.0/dbfs/create`, { path: destPath, overwrite: true });
    const handle = createRes.handle;

    // 3. Read loop
    let offset = 0;
    const length = 1024 * 1024; // 1MB chunks

    while (true) {
      const res = await this._request('GET', `/api/2.0/dbfs/read?path=${encodeURIComponent(srcPath)}&offset=${offset}&length=${length}`);
      
      if (res.data) {
        await this._request('POST', `/api/2.0/dbfs/add-block`, {
          handle: handle,
          data: res.data
        });
        offset += res.bytes_read;
        
        if (onProgress) {
          const progress = totalSize > 0 ? Math.round((offset / totalSize) * 100) : -1;
          onProgress({ status: 'copying', file: path.posix.basename(destPath), progress });
        }
      }

      if (res.bytes_read < length) {
        break;
      }
    }

    await this._request('POST', `/api/2.0/dbfs/close`, { handle: handle });
    if (onProgress) onProgress({ status: 'completed', file: path.posix.basename(destPath), progress: 100 });
    return destPath;
  }
}

module.exports = DbfsProvider;
