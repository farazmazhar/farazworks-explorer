class ProviderManager {
  constructor() {
    this.providers = new Map();
  }

  registerProvider(provider) {
    if (this.providers.has(provider.getId())) {
      console.warn(`Provider with id ${provider.getId()} is already registered.`);
      return;
    }
    this.providers.set(provider.getId(), provider);
  }

  removeProvider(id) {
    if (this.providers.has(id)) {
      this.providers.delete(id);
      return true;
    }
    return false;
  }

  getProvider(id) {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Provider with id ${id} not found.`);
    }
    return provider;
  }

  getProviderInstances() {
    return Array.from(this.providers.values());
  }

  getAllProviders() {
    return Array.from(this.providers.values()).map(p => ({
      id: p.getId(),
      name: p.getName()
    }));
  }

  async listFiles(providerId, path) {
    return this.getProvider(providerId).list(path);
  }

  async delete(providerId, path) {
    return this.getProvider(providerId).delete(path);
  }

  async rename(providerId, oldPath, newName) {
    return this.getProvider(providerId).rename(oldPath, newName);
  }

  async copy(srcProviderId, destProviderId, srcPath, destDir, onProgress) {
    if (srcProviderId === destProviderId) {
      return this.getProvider(srcProviderId).copy(srcPath, destDir, onProgress);
    } else if (srcProviderId === 'local' && destProviderId !== 'local') {
      const destProvider = this.getProvider(destProviderId);
      if (typeof destProvider.upload === 'function') {
        return destProvider.upload(srcPath, destDir, onProgress);
      } else {
        throw new Error('Destination provider does not support direct upload.');
      }
    } else if (srcProviderId !== 'local' && destProviderId === 'local') {
      const srcProvider = this.getProvider(srcProviderId);
      if (typeof srcProvider.download === 'function') {
        return srcProvider.download(srcPath, destDir, onProgress);
      } else {
        throw new Error('Source provider does not support direct download.');
      }
    }
    throw new Error('Cross-cloud copying is not supported yet.');
  }

  async move(srcProviderId, destProviderId, srcPath, destDir) {
    if (srcProviderId !== destProviderId) {
      throw new Error('Move across different providers is not supported. Use copy instead.');
    }
    return this.getProvider(srcProviderId).move(srcPath, destDir);
  }

  async mkdir(providerId, targetDir, folderName) {
    return this.getProvider(providerId).mkdir(targetDir, folderName);
  }
}

module.exports = ProviderManager;
