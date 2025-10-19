# Git Viz - VS Code & Cursor Extension

A Visual Studio Code and Cursor extension for visualizing git repositories with interactive graphs and commit history.

## Features

- 📊 **Commit History Visualization** - Interactive timeline of commits
- 🌳 **Branch Graph Display** - Visual representation of branch relationships
- 📁 **File Change Tracking** - Track modifications across commits
- 🔍 **Interactive Git Log** - Enhanced git log with visual elements

## Installation

### From VS Code Marketplace (Recommended)

1. Open VS Code or Cursor
2. Go to the Extensions view (`Ctrl+Shift+X`)
3. Search for "Git Viz"
4. Click Install

### From Source (Development)

1. Clone this repository
2. Press `F5` to open a new Extension Development Host window
3. The extension will be loaded in the new window

**Note**: This extension no longer requires Node.js as a prerequisite. It uses VS Code's built-in Git API instead of executing git commands directly.

## Usage

1. Open a git repository in VS Code or Cursor
2. Open Git Viz using one of these methods:
   - **Command Palette**: Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and type "Git Viz: Open"
   - **Context Menu**: Right-click in the Explorer panel and select "Open Git Viz"
3. The Git Visualization panel will open with interactive features

## Development

### Prerequisites

- Visual Studio Code or Cursor
- Git repository (the extension uses VS Code's built-in Git API)

### Setup

This extension is now written in pure JavaScript and uses VS Code's built-in Git API, so no build process or Node.js dependencies are required.

1. Clone this repository
2. Press `F5` to open a new Extension Development Host window
3. The extension will be loaded in the new window

### Building

```bash
# Package the extension (requires vsce)
vsce package
```

## Commands

- `Git Viz: Open` - Opens the Git Visualization panel

## Configuration

The extension automatically detects git repositories and provides visualization features based on the current workspace.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or have feature requests, please open an issue on GitHub.

<br>

## Support Me

If you find this application helpful, consider supporting me on Ko-fi!

[Support me on Ko-fi](https://ko-fi.com/kambei)
