const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class LocalProvider {
  constructor(id = 'local', name = 'Local Drive', rootPath = null) {
    this.id = id;
    this.name = name;
    this.rootPath = rootPath;
  }

  getId() {
    return this.id;
  }

  getName() {
    return this.name;
  }

  serialize() {
    return { type: 'local', id: this.id, name: this.name, rootPath: this.rootPath };
  }

  async list(targetPath) {
    if (!targetPath) {
      targetPath = this.rootPath || os.homedir();
    }

    try {
      const items = await fs.readdir(targetPath, { withFileTypes: true });
      const results = [];

      for (const item of items) {
        try {
          const itemPath = path.join(targetPath, item.name);
          const stats = await fs.stat(itemPath);
          
          results.push({
            name: item.name,
            path: itemPath,
            isDir: stats.isDirectory(),
            size: stats.isDirectory() ? 0 : stats.size,
            lastModified: stats.mtime
          });
        } catch (err) {
          // Ignore files that can't be accessed
        }
      }

      // Sort: Directories first, then alphabetical
      results.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });

      return {
        path: targetPath,
        items: results
      };
    } catch (error) {
      console.error(`Error listing directory ${targetPath}:`, error);
      throw error;
    }
  }

  async delete(targetPath) {
    await fs.rm(targetPath, { recursive: true, force: true });
  }

  async rename(oldPath, newName) {
    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, newName);
    await fs.rename(oldPath, newPath);
    return newPath;
  }

  async _getUniquePath(destPath) {
    try {
      await fs.access(destPath);
    } catch (err) {
      return destPath;
    }

    const ext = path.extname(destPath);
    const base = path.basename(destPath, ext);
    const dir = path.dirname(destPath);
    
    let counter = 1;
    while (true) {
      const newPath = path.join(dir, `${base}-${counter}${ext}`);
      try {
        await fs.access(newPath);
        counter++;
      } catch (err) {
        return newPath;
      }
    }
  }

  async copy(srcPath, destDir, onProgress) {
    const fileName = path.basename(srcPath);
    let destPath = path.join(destDir, fileName);
    
    destPath = await this._getUniquePath(destPath);

    // Call progress callback to start indeterminate loader
    if (onProgress) onProgress({ status: 'copying', file: fileName, progress: -1 });

    await fs.cp(srcPath, destPath, { recursive: true });
    
    if (onProgress) onProgress({ status: 'completed', file: fileName, progress: 100 });
    return destPath;
  }

  async move(srcPath, destDir) {
    const fileName = path.basename(srcPath);
    let destPath = path.join(destDir, fileName);
    
    destPath = await this._getUniquePath(destPath);

    await fs.rename(srcPath, destPath);
    return destPath;
  }

  async mkdir(targetDir, folderName) {
    let destPath = path.join(targetDir, folderName);
    destPath = await this._getUniquePath(destPath);
    await fs.mkdir(destPath, { recursive: true });
    return destPath;
  }
}

module.exports = LocalProvider;
