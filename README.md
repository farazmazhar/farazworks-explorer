# FarazWorks Explorer

FarazWorks Explorer is a modern, cross-platform desktop file explorer built with Electron. It features a highly extensible architecture designed to seamlessly bridge local storage with cloud-based file systems like Databricks File System (DBFS).

> **Note:** This is a "vibe coded" project and is intended strictly for personal use.

## Features

- **Extensible Provider Architecture**: Designed to support multiple storage backends through a unified API.
- **Local & Cloud Storage Support**:
  - **Local Drive**: Full native support for file operations, moving, copying, and deleting.
  - **Databricks (DBFS)**: Natively connects to Databricks workspaces. Supports `.databrickscfg` profile parsing or manual PAT tokens, and features automated chunked streaming for handling large file transfers without hitting API payload limits.
- **Cross-Provider Transfers**: Effortlessly drag and drop files from your OS into cloud providers, or seamlessly copy and paste files between different storage mechanisms.
- **Persistent Configuration**: Automatically caches your configured providers so you never have to re-enter your connection details.
- **Modern UI**: A sleek, dark-themed interface inspired by Azure Storage Explorer, complete with a collapsible tree-view sidebar and dynamic SVGs.
- **Portable Setup**: Designed to run as a fully portable application without cluttering system directories.

## Installation & Build

Ensure you have [Node.js](https://nodejs.org/) installed, then clone the repository:

```bash
git clone https://github.com/farazmazhar/farazworks-explorer.git
cd farazworks-explorer
npm install
```

### Running Locally

To start the application in development mode:
```bash
npm start
```

### Building a Portable Executable

To package the application into a portable executable for your operating system:
```bash
npm run build
```
- On **Windows**, this outputs a single `.exe` portable executable.
- On **Linux**, this outputs an `AppImage`.
Builds are saved in the `dist/` directory.

## License

ISC License
