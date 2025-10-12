import * as vscode from 'vscode';
import { GitService, GitFilters, GitBranch, GitTag, GitCommit, BranchRelationship } from './gitService';
import { HorizontalGraphRenderer } from './graphRenderer';
import { GitVizViewProvider } from './gitVizViewProvider';

export function activate(context: vscode.ExtensionContext) {
	console.log('Git Viz extension is now active!');

	// Register the view provider
	const gitVizProvider = new GitVizViewProvider();
	vscode.window.registerTreeDataProvider('git-viz-view', gitVizProvider);

	// Register commands
	const openCommand = vscode.commands.registerCommand('git-viz.open', () => {
		openGitVisualization(context);
	});

	const refreshCommand = vscode.commands.registerCommand('git-viz.refresh', () => {
		refreshGitVisualization();
		gitVizProvider.refresh();
	});

	const zoomInCommand = vscode.commands.registerCommand('git-viz.zoomIn', () => {
		zoomIn();
	});

	const zoomOutCommand = vscode.commands.registerCommand('git-viz.zoomOut', () => {
		zoomOut();
	});

	context.subscriptions.push(openCommand, refreshCommand, zoomInCommand, zoomOutCommand);
}

let currentPanel: vscode.WebviewPanel | undefined;
let currentGitService: GitService | undefined;
let currentRenderer: HorizontalGraphRenderer | undefined;
let currentFilters: GitFilters = {
	maxCommits: 200, // Reduced default for faster loading
	maxBranches: 20
};

function openGitVisualization(context: vscode.ExtensionContext) {
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('No workspace folder found');
		return;
	}

	currentGitService = new GitService(workspaceRoot);

	// Create and show a new webview panel
	currentPanel = vscode.window.createWebviewPanel(
		'gitViz',
		'Git Visualization',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
		}
	);

	// Set the webview's initial html content
	currentPanel.webview.html = getWebviewContent();

	// Handle messages from the webview
	currentPanel.webview.onDidReceiveMessage(
		async message => {
			switch (message.command) {
				case 'loadGitData':
					await loadGitData();
					break;
				case 'applyFilters':
					currentFilters = message.filters;
					// Clear cache when filters change
					if (currentGitService) {
						currentGitService.clearCache();
					}
					await loadGitData();
					break;
				case 'showCommitDetails':
					showCommitDetails(message.commit);
					break;
				case 'showAuthorDetails':
					showAuthorDetails(message.author, message.authorEmail);
					break;
				case 'showCommitMessageDetails':
					showCommitMessageDetails(message.commit);
					break;
			}
		},
		undefined,
		context.subscriptions
	);

	// Load initial data
	loadGitData();
}

/*
function filterRelevantBranches(allBranches: GitBranch[], commits: GitCommit[]): GitBranch[] {
	// Extract all branch names mentioned in the commits
	const commitBranchNames = new Set<string>();
	
	for (const commit of commits) {
		for (const ref of commit.refs) {
			if (ref.startsWith('Branch ')) {
				const branchName = ref.replace('Branch ', '');
				// Clean up branch name to match the format used in getBranches()
				const cleanName = branchName.replace(/^remotes\/origin\//, '');
				commitBranchNames.add(cleanName);
			}
		}
	}
	
	console.log('All branches:', allBranches.map(b => b.name));
	console.log('Commit branch names:', Array.from(commitBranchNames));
	
	// Filter branches to only include those mentioned in commits
	const filtered = allBranches.filter(branch => commitBranchNames.has(branch.name));
	console.log('Filtered branches:', filtered.map(b => b.name));
	
	return filtered;
}

function filterRelevantTags(allTags: GitTag[], commits: GitCommit[]): GitTag[] {
	// Extract all tag names mentioned in the commits
	const commitTagNames = new Set<string>();
	
	for (const commit of commits) {
		for (const ref of commit.refs) {
			if (ref.startsWith('Tag ')) {
				const tagName = ref.replace('Tag ', '');
				commitTagNames.add(tagName);
			}
		}
	}
	
	console.log('All tags:', allTags.map(t => t.name));
	console.log('Commit tag names:', Array.from(commitTagNames));
	
	// Filter tags to only include those mentioned in commits
	const filtered = allTags.filter(tag => commitTagNames.has(tag.name));
	console.log('Filtered tags:', filtered.map(t => t.name));
	
	return filtered;
}
*/

async function loadGitData() {
	if (!currentPanel || !currentGitService) {
		return;
	}

	try {
		// Check if it's a git repository
		const isGitRepo = await currentGitService.isGitRepository();
		if (!isGitRepo) {
			currentPanel.webview.postMessage({
				command: 'updateStatus',
				status: 'Not a git repository'
			});
			return;
		}

		// Show initial loading status
		currentPanel.webview.postMessage({
			command: 'updateStatus',
			status: 'Loading git data...'
		});

		// Get git data with progress updates
		const gitDataPromises = [
			{ name: 'commits', promise: currentGitService.getCommits(currentFilters) },
			{ name: 'branches', promise: currentGitService.getBranches() },
			{ name: 'tags', promise: currentGitService.getTags() },
			{ name: 'authors', promise: currentGitService.getAuthors() },
			{ name: 'relationships', promise: currentGitService.getBranchRelationships() }
		];

		// Track progress
		let completedCount = 0;
		const totalCount = gitDataPromises.length;

		// Execute promises with progress updates
		const results = await Promise.all(
			gitDataPromises.map(async ({ name, promise }) => {
				const result = await promise;
				completedCount++;
				
				// Send progress update
				if (currentPanel) {
					currentPanel.webview.postMessage({
						command: 'updateStatus',
						status: `Loading git data... ${completedCount}/${totalCount} (${name})`
					});
				}
				
				return result;
			})
		);

		const [commits, allBranches, allTags, authors, branchRelationships] = results as [GitCommit[], GitBranch[], GitTag[], string[], BranchRelationship[]];

		// Filter branches and tags based on what's actually in the filtered commits
		// const relevantBranches = filterRelevantBranches(allBranches, commits);
		// const relevantTags = filterRelevantTags(allTags, commits);
		
		// Use all branches and tags for now
		const relevantBranches = allBranches;
		const relevantTags = allTags;

		// Create graph renderer
		currentRenderer = new HorizontalGraphRenderer(commits);

		// Start gradual rendering
		await startGradualRendering(commits, relevantBranches, relevantTags, authors, branchRelationships);

	} catch (error) {
		console.error('Error loading git data:', error);
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		currentPanel.webview.postMessage({
			command: 'updateStatus',
			status: `Error: ${errorMessage}`
		});
		
		// Show error in VS Code notification
		vscode.window.showErrorMessage(`Git Viz Error: ${errorMessage}`);
	}
}

async function startGradualRendering(commits: any[], branches: any[], tags: any[], authors: string[], branchRelationships: any[]) {
	if (!currentPanel || !currentRenderer) {
		return;
	}

	try {
		// Send initial data without graph
		currentPanel.webview.postMessage({
			command: 'updateGitData',
			commits,
			branches,
			tags,
			authors,
			branchRelationships,
			graphSvg: '',
			filters: currentFilters,
			status: `Preparing to render ${commits.length} commits...`,
			useGradualRendering: true
		});

		// Start with initial render
		const initialResult = currentRenderer.renderInitial();
		
		// Send initial graph
		currentPanel.webview.postMessage({
			command: 'updateGraphProgress',
			svg: initialResult.svg,
			progress: initialResult.progress,
			isComplete: initialResult.isComplete,
			status: `Rendering commits... ${Math.round(initialResult.progress)}%`
		});

		// Continue rendering chunks
		let currentSvg = initialResult.svg;
		while (!initialResult.isComplete) {
			// Add small delay to prevent blocking the UI (reduced for faster rendering)
			await new Promise(resolve => setTimeout(resolve, 30));
			
			const chunkResult = currentRenderer.renderNextChunk(currentSvg);
			currentSvg = chunkResult.svg;
			
			// Send progress update
			currentPanel.webview.postMessage({
				command: 'updateGraphProgress',
				svg: chunkResult.svg,
				progress: chunkResult.progress,
				isComplete: chunkResult.isComplete,
				status: `Rendering commits... ${Math.round(chunkResult.progress)}%`
			});

			if (chunkResult.isComplete) {
				break;
			}
		}

		// Send final status
		currentPanel.webview.postMessage({
			command: 'updateStatus',
			status: `Showing ${commits.length} commits • ${branches.length} branches`
		});

	} catch (error) {
		console.error('Error during gradual rendering:', error);
		currentPanel.webview.postMessage({
			command: 'updateStatus',
			status: `Rendering error: ${error instanceof Error ? error.message : 'Unknown error'}`
		});
	}
}

function refreshGitVisualization() {
	if (currentPanel) {
		loadGitData();
	}
}

function zoomIn() {
	if (currentPanel) {
		currentPanel.webview.postMessage({
			command: 'zoomIn'
		});
	}
}

function zoomOut() {
	if (currentPanel) {
		currentPanel.webview.postMessage({
			command: 'zoomOut'
		});
	}
}

async function showCommitDetails(commit: any) {
	const message = vscode.window.createWebviewPanel(
		'commitDetails',
		`Commit ${commit.shortHash}`,
		vscode.ViewColumn.Two,
		{ enableScripts: true }
	);

	// Fetch file changes
	let fileChanges: any[] = [];
	if (currentGitService) {
		try {
			fileChanges = await currentGitService.getFileChanges(commit.hash);
		} catch (error) {
			console.error('Error fetching file changes:', error);
		}
	}

	message.webview.html = `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Commit Details</title>
			<style>
				body {
					font-family: var(--vscode-font-family);
					font-size: var(--vscode-font-size);
					color: var(--vscode-foreground);
					background-color: var(--vscode-editor-background);
					padding: 20px;
					margin: 0;
				}
				.commit-header {
					border-bottom: 1px solid var(--vscode-panel-border);
					padding-bottom: 15px;
					margin-bottom: 20px;
				}
				.commit-hash {
					font-family: monospace;
					background-color: var(--vscode-textCodeBlock-background);
					padding: 4px 8px;
					border-radius: 4px;
					display: inline-block;
					margin-bottom: 10px;
				}
				.commit-message {
					font-size: 16px;
					font-weight: bold;
					margin-bottom: 10px;
				}
				.commit-author {
					color: var(--vscode-descriptionForeground);
					margin-bottom: 5px;
				}
				.commit-date {
					color: var(--vscode-descriptionForeground);
					font-size: 12px;
				}
				.commit-body {
					white-space: pre-wrap;
					background-color: var(--vscode-textCodeBlock-background);
					padding: 15px;
					border-radius: 4px;
					margin-top: 15px;
					margin-bottom: 20px;
				}
				.file-changes-section {
					margin-top: 20px;
				}
				.file-changes-header {
					font-size: 14px;
					font-weight: bold;
					margin-bottom: 10px;
					color: var(--vscode-foreground);
				}
				.file-changes-list {
					background-color: var(--vscode-textCodeBlock-background);
					border-radius: 4px;
					padding: 10px;
					max-height: 300px;
					overflow-y: auto;
				}
				.file-change-item {
					display: flex;
					align-items: center;
					padding: 6px 8px;
					margin: 2px 0;
					border-radius: 3px;
					transition: background-color 0.2s;
				}
				.file-change-item:hover {
					background-color: var(--vscode-list-hoverBackground);
				}
				.file-status {
					width: 20px;
					height: 20px;
					border-radius: 3px;
					display: flex;
					align-items: center;
					justify-content: center;
					font-size: 10px;
					font-weight: bold;
					margin-right: 8px;
					flex-shrink: 0;
				}
				.file-status.added {
					background-color: #28a745;
					color: white;
				}
				.file-status.modified {
					background-color: #ffc107;
					color: black;
				}
				.file-status.deleted {
					background-color: #dc3545;
					color: white;
				}
				.file-status.renamed {
					background-color: #17a2b8;
					color: white;
				}
				.file-name {
					flex: 1;
					font-family: monospace;
					font-size: 12px;
					word-break: break-all;
				}
				.file-stats {
					font-size: 11px;
					color: var(--vscode-descriptionForeground);
					margin-left: 8px;
					flex-shrink: 0;
				}
				.file-stats .additions {
					color: #28a745;
				}
				.file-stats .deletions {
					color: #dc3545;
				}
				.no-changes {
					color: var(--vscode-descriptionForeground);
					font-style: italic;
					text-align: center;
					padding: 20px;
				}
			</style>
		</head>
		<body>
			<div class="commit-header">
				<div class="commit-hash">${commit.hash}</div>
				<div class="commit-message">${commit.message}</div>
				<div class="commit-author">${commit.author} &lt;${commit.authorEmail}&gt;</div>
				<div class="commit-date">${commit.date}</div>
			</div>
			<div class="commit-body">${commit.fullMessage}</div>
			
			<div class="file-changes-section">
				<div class="file-changes-header">Files Changed (${fileChanges.length})</div>
				<div class="file-changes-list">
					${fileChanges.length === 0 ? 
						'<div class="no-changes">No file changes found</div>' :
						fileChanges.map(change => `
							<div class="file-change-item">
								<div class="file-status ${getStatusClass(change.status)}">${change.status}</div>
								<div class="file-name">${change.file}</div>
								<div class="file-stats">
									${change.additions > 0 ? `<span class="additions">+${change.additions}</span>` : ''}
									${change.deletions > 0 ? `<span class="deletions">-${change.deletions}</span>` : ''}
								</div>
							</div>
						`).join('')
					}
				</div>
			</div>
		</body>
		</html>
	`;
}

function getStatusClass(status: string): string {
	switch (status) {
		case 'A': return 'added';
		case 'M': return 'modified';
		case 'D': return 'deleted';
		case 'R': return 'renamed';
		case 'C': return 'copied';
		default: return 'modified';
	}
}

function getFileIcon(fileName: string): string {
	const extension = fileName.split('.').pop()?.toLowerCase() || '';
	const baseName = fileName.split('/').pop()?.toLowerCase() || '';
	
	// Common file extensions and their icons
	const iconMap: { [key: string]: string } = {
		// Code files
		'js': '📄', 'ts': '📘', 'jsx': '⚛️', 'tsx': '⚛️',
		'py': '🐍', 'java': '☕', 'cpp': '⚙️', 'c': '⚙️', 'h': '⚙️',
		'cs': '🔷', 'php': '🐘', 'rb': '💎', 'go': '🐹', 'rs': '🦀',
		'kt': '🟣', 'swift': '🍎', 'dart': '🎯', 'scala': '🔴',
		
		// Web files
		'html': '🌐', 'htm': '🌐', 'css': '🎨', 'scss': '🎨', 'sass': '🎨',
		'less': '🎨', 'vue': '💚', 'svelte': '🧡',
		
		// Config files
		'json': '📋', 'xml': '📄', 'yaml': '📄', 'yml': '📄',
		'toml': '📄', 'ini': '📄', 'cfg': '📄', 'conf': '📄',
		'env': '🔧', 'gitignore': '🚫', 'dockerfile': '🐳',
		
		// Documentation
		'md': '📝', 'txt': '📄', 'rst': '📄', 'adoc': '📄',
		
		// Images
		'png': '🖼️', 'jpg': '🖼️', 'jpeg': '🖼️', 'gif': '🖼️',
		'svg': '🎨', 'ico': '🖼️', 'webp': '🖼️',
		
		// Archives
		'zip': '📦', 'tar': '📦', 'gz': '📦', 'rar': '📦',
		'7z': '📦', 'bz2': '📦',
		
		// Special files
		'lock': '🔒', 'log': '📊', 'sql': '🗄️', 'sh': '🐚',
		'bat': '🐚', 'ps1': '🐚', 'exe': '⚙️', 'dll': '⚙️'
	};
	
	// Check for special file names
	if (baseName === 'package.json') return '📦';
	if (baseName === 'readme.md') return '📖';
	if (baseName === 'license') return '📜';
	if (baseName === 'makefile') return '🔨';
	if (baseName === 'dockerfile') return '🐳';
	if (baseName === 'docker-compose.yml') return '🐳';
	if (baseName.startsWith('.')) return '⚙️';
	
	return iconMap[extension] || '📄';
}

function getFileDisplayName(fileName: string): { name: string; path: string } {
	const parts = fileName.split('/');
	const name = parts.pop() || fileName;
	const path = parts.join('/');
	return { name, path };
}

function showAuthorDetails(author: string, authorEmail: string) {
	const message = vscode.window.createWebviewPanel(
		'authorDetails',
		`Author: ${author}`,
		vscode.ViewColumn.Two,
		{ enableScripts: true }
	);

	message.webview.html = `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Author Details</title>
			<style>
				body {
					font-family: var(--vscode-font-family);
					font-size: var(--vscode-font-size);
					color: var(--vscode-foreground);
					background-color: var(--vscode-editor-background);
					padding: 20px;
				}
				.author-header {
					border-bottom: 1px solid var(--vscode-panel-border);
					padding-bottom: 15px;
					margin-bottom: 20px;
				}
				.author-name {
					font-size: 18px;
					font-weight: bold;
					margin-bottom: 10px;
				}
				.author-email {
					color: var(--vscode-descriptionForeground);
					font-size: 14px;
				}
			</style>
		</head>
		<body>
			<div class="author-header">
				<div class="author-name">${author}</div>
				<div class="author-email">${authorEmail}</div>
			</div>
			<p>This author has contributed to this repository.</p>
		</body>
		</html>
	`;
}

async function showCommitMessageDetails(commit: any) {
	const message = vscode.window.createWebviewPanel(
		'commitMessageDetails',
		`Commit Message: ${commit.shortHash}`,
		vscode.ViewColumn.Two,
		{ enableScripts: true }
	);

	// Fetch file changes
	let fileChanges: any[] = [];
	if (currentGitService) {
		try {
			fileChanges = await currentGitService.getFileChanges(commit.hash);
		} catch (error) {
			console.error('Error fetching file changes:', error);
		}
	}

	message.webview.html = `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Commit Message Details</title>
			<style>
				body {
					font-family: var(--vscode-font-family);
					font-size: var(--vscode-font-size);
					color: var(--vscode-foreground);
					background-color: var(--vscode-editor-background);
					padding: 20px;
					margin: 0;
				}
				.commit-header {
					border-bottom: 1px solid var(--vscode-panel-border);
					padding-bottom: 15px;
					margin-bottom: 20px;
				}
				.commit-hash {
					font-family: monospace;
					background-color: var(--vscode-textCodeBlock-background);
					padding: 4px 8px;
					border-radius: 4px;
					display: inline-block;
					margin-bottom: 10px;
				}
				.commit-message {
					font-size: 16px;
					font-weight: bold;
					margin-bottom: 10px;
				}
				.commit-author {
					color: var(--vscode-descriptionForeground);
					margin-bottom: 5px;
				}
				.commit-date {
					color: var(--vscode-descriptionForeground);
					font-size: 12px;
				}
				.commit-body {
					white-space: pre-wrap;
					background-color: var(--vscode-textCodeBlock-background);
					padding: 15px;
					border-radius: 4px;
					margin-top: 15px;
					margin-bottom: 20px;
				}
				.file-changes-section {
					margin-top: 20px;
				}
				.file-changes-header {
					font-size: 14px;
					font-weight: bold;
					margin-bottom: 10px;
					color: var(--vscode-foreground);
				}
				.file-changes-list {
					background-color: var(--vscode-textCodeBlock-background);
					border-radius: 4px;
					padding: 10px;
					max-height: 300px;
					overflow-y: auto;
				}
				.file-change-item {
					display: flex;
					align-items: center;
					padding: 6px 8px;
					margin: 2px 0;
					border-radius: 3px;
					transition: background-color 0.2s;
				}
				.file-change-item:hover {
					background-color: var(--vscode-list-hoverBackground);
				}
				.file-status {
					width: 20px;
					height: 20px;
					border-radius: 3px;
					display: flex;
					align-items: center;
					justify-content: center;
					font-size: 10px;
					font-weight: bold;
					margin-right: 8px;
					flex-shrink: 0;
				}
				.file-status.added {
					background-color: #28a745;
					color: white;
				}
				.file-status.modified {
					background-color: #ffc107;
					color: black;
				}
				.file-status.deleted {
					background-color: #dc3545;
					color: white;
				}
				.file-status.renamed {
					background-color: #17a2b8;
					color: white;
				}
				.file-name {
					flex: 1;
					font-family: monospace;
					font-size: 12px;
					word-break: break-all;
				}
				.file-stats {
					font-size: 11px;
					color: var(--vscode-descriptionForeground);
					margin-left: 8px;
					flex-shrink: 0;
				}
				.file-stats .additions {
					color: #28a745;
				}
				.file-stats .deletions {
					color: #dc3545;
				}
				.no-changes {
					color: var(--vscode-descriptionForeground);
					font-style: italic;
					text-align: center;
					padding: 20px;
				}
			</style>
		</head>
		<body>
			<div class="commit-header">
				<div class="commit-hash">${commit.hash}</div>
				<div class="commit-message">${commit.message}</div>
				<div class="commit-author">${commit.author} &lt;${commit.authorEmail}&gt;</div>
				<div class="commit-date">${commit.date}</div>
			</div>
			<div class="commit-body">${commit.fullMessage}</div>
			
			<div class="file-changes-section">
				<div class="file-changes-header">Files Changed (${fileChanges.length})</div>
				<div class="file-changes-list">
					${fileChanges.length === 0 ? 
						'<div class="no-changes">No file changes found</div>' :
						fileChanges.map(change => `
							<div class="file-change-item">
								<div class="file-status ${getStatusClass(change.status)}">${change.status}</div>
								<div class="file-name">${change.file}</div>
								<div class="file-stats">
									${change.additions > 0 ? `<span class="additions">+${change.additions}</span>` : ''}
									${change.deletions > 0 ? `<span class="deletions">-${change.deletions}</span>` : ''}
								</div>
							</div>
						`).join('')
					}
				</div>
			</div>
		</body>
		</html>
	`;
}

function getWebviewContent() {
	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git Visualization</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-weight: var(--vscode-font-weight);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 0;
            overflow: hidden;
        }
        
        .container {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        
        .toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 16px;
            background-color: var(--vscode-panel-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
        }
        
        .status {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        
        .controls {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        
        .btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: background-color 0.2s ease;
        }
        
        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .btn:active {
            background-color: var(--vscode-button-activeBackground);
        }
        
        .btn:disabled {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: not-allowed;
        }
        
        .filters {
            display: flex;
            gap: 8px;
            align-items: center;
            padding: 8px 16px;
            background-color: var(--vscode-panel-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
        }
        
        .filter-group {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .filter-group label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        
        select, input {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
        }
        
        .graph-container {
            flex: 1;
            overflow: auto;
            position: relative;
            cursor: grab;
        }
        
        .graph-container:active {
            cursor: grabbing;
        }
        
        .graph-svg {
            display: block;
            margin: 0 auto;
        }
        
        .loading {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100%;
            color: var(--vscode-descriptionForeground);
        }
        
        .error {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100%;
            color: var(--vscode-errorForeground);
            text-align: center;
            padding: 20px;
        }
        
        .progress-container {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: var(--vscode-panel-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            min-width: 300px;
            z-index: 1000;
        }
        
        .progress-bar {
            width: 100%;
            height: 8px;
            background-color: var(--vscode-progressBar-background);
            border-radius: 4px;
            overflow: hidden;
            margin: 10px 0;
        }
        
        .progress-fill {
            height: 100%;
            background-color: var(--vscode-progressBar-foreground);
            border-radius: 4px;
            transition: width 0.3s ease;
            width: 0%;
        }
        
        .progress-text {
            text-align: center;
            color: var(--vscode-foreground);
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="toolbar">
            <div class="status" id="status">Loading...</div>
            <div class="controls">
                <button class="btn" onclick="showLimitsDialog()">Limits…</button>
                <button class="btn" onclick="resetView()">Reset</button>
                <button class="btn" onclick="zoomOut()">-</button>
                <button class="btn" onclick="zoomIn()">+</button>
            </div>
        </div>
        
        <div class="filters">
            <div class="filter-group">
                <label>Author:</label>
                <select id="authorFilter">
                    <option value="">All authors</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Message:</label>
                <input type="text" id="messageFilter" placeholder="Search in messages">
            </div>
            <button class="btn" onclick="clearFilters()">Clear</button>
        </div>
        
        <div class="graph-container" id="graphContainer">
            <div class="loading">Loading git data...</div>
        </div>
        
        <!-- Progress overlay -->
        <div class="progress-container" id="progressContainer" style="display: none;">
            <div class="progress-text" id="progressText">Rendering commits...</div>
            <div class="progress-bar">
                <div class="progress-fill" id="progressFill"></div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        let currentScale = 1.0;
        let currentData = null;
        let isDragging = false;
        let dragStart = { x: 0, y: 0 };
        let currentTranslate = { x: 0, y: 0 };
        let messageFilterTimeout = null;
        
        function updateStatus(message) {
            document.getElementById('status').textContent = message;
        }
        
        function updateGitData(data) {
            currentData = data;
            
            // Update status
            updateStatus(data.status || 'Ready');
            
            // Update filter dropdowns
            updateAuthorFilter(data.authors || []);
            
            // Set up message filter with debouncing
            setupMessageFilter();
            
            // Update graph (only if not using gradual rendering)
            if (!data.useGradualRendering && data.graphSvg) {
                updateGraph(data.graphSvg);
            }
        }
        
        function updateGraphProgress(data) {
            // Update status with progress
            updateStatus(data.status || 'Rendering...');
            
            // Show progress bar
            const progressContainer = document.getElementById('progressContainer');
            const progressFill = document.getElementById('progressFill');
            const progressText = document.getElementById('progressText');
            
            if (progressContainer && progressFill && progressText) {
                progressContainer.style.display = 'block';
                progressFill.style.width = (data.progress || 0) + '%';
                progressText.textContent = data.status || 'Rendering...';
            }
            
            // Update graph with new SVG content
            if (data.svg) {
                updateGraph(data.svg);
            }
            
            // Hide progress bar when complete
            if (data.isComplete) {
                setTimeout(() => {
                    if (progressContainer) {
                        progressContainer.style.display = 'none';
                    }
                    updateStatus('Rendering complete');
                }, 1000);
            }
        }
        
        /*
        function updateBranchFilter(branches) {
            const select = document.getElementById('branchFilter');
            select.innerHTML = '<option value="">All branches</option>';
            branches.forEach(branch => {
                const option = document.createElement('option');
                option.value = branch.name;
                option.textContent = branch.name;
                if (branch.isCurrent) {
                    option.textContent += ' (current)';
                }
                select.appendChild(option);
            });
            
            // Remove any existing event listeners by cloning the element
            const newSelect = select.cloneNode(true);
            select.parentNode.replaceChild(newSelect, select);
            
            // Add event listener for immediate filtering
            newSelect.addEventListener('change', applyFilters);
        }
        
        function updateTagFilter(tags) {
            const select = document.getElementById('tagFilter');
            select.innerHTML = '<option value="">All tags</option>';
            tags.forEach(tag => {
                const option = document.createElement('option');
                option.value = tag.name;
                option.textContent = tag.name;
                select.appendChild(option);
            });
            
            // Remove any existing event listeners by cloning the element
            const newSelect = select.cloneNode(true);
            select.parentNode.replaceChild(newSelect, select);
            
            // Add event listener for immediate filtering
            newSelect.addEventListener('change', applyFilters);
        }
        */
        
        function updateAuthorFilter(authors) {
            const select = document.getElementById('authorFilter');
            select.innerHTML = '<option value="">All authors</option>';
            authors.forEach(author => {
                const option = document.createElement('option');
                option.value = author;
                option.textContent = author;
                select.appendChild(option);
            });
            
            // Remove any existing event listeners by cloning the element
            const newSelect = select.cloneNode(true);
            select.parentNode.replaceChild(newSelect, select);
            
            // Add event listener for immediate filtering
            newSelect.addEventListener('change', applyFilters);
        }
        
        function setupMessageFilter() {
            const messageInput = document.getElementById('messageFilter');
            if (messageInput) {
                // Remove any existing event listeners by cloning the element
                const newInput = messageInput.cloneNode(true);
                messageInput.parentNode.replaceChild(newInput, messageInput);
                
                // Add debounced input event listener
                newInput.addEventListener('input', function() {
                    // Clear existing timeout
                    if (messageFilterTimeout) {
                        clearTimeout(messageFilterTimeout);
                    }
                    
                    // Set new timeout for debounced filtering
                    messageFilterTimeout = setTimeout(() => {
                        applyFilters();
                    }, 500); // 500ms delay
                });
            }
        }
        
        function updateGraph(svgContent) {
            const container = document.getElementById('graphContainer');
            container.innerHTML = svgContent;
            
            // Add click handlers to commit nodes
            const nodes = container.querySelectorAll('.commit-node');
            nodes.forEach(node => {
                node.addEventListener('click', (e) => {
                    const hash = e.target.getAttribute('data-hash');
                    if (hash && currentData) {
                        const commit = currentData.commits.find(c => c.hash === hash);
                        if (commit) {
                            vscode.postMessage({
                                command: 'showCommitDetails',
                                commit: commit
                            });
                        }
                    }
                });
            });
            
            // Add click handlers to clickable authors
            const authors = container.querySelectorAll('.clickable-author');
            authors.forEach(author => {
                author.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent triggering commit node click
                    const authorName = e.target.getAttribute('data-author');
                    const authorEmail = e.target.getAttribute('data-author-email');
                    if (authorName) {
                        vscode.postMessage({
                            command: 'showAuthorDetails',
                            author: authorName,
                            authorEmail: authorEmail || ''
                        });
                    }
                });
            });
            
            // Add click handlers to clickable messages
            const messages = container.querySelectorAll('.clickable-message');
            messages.forEach(message => {
                message.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent triggering commit node click
                    const hash = e.target.getAttribute('data-hash');
                    const messageText = e.target.getAttribute('data-message');
                    const fullMessage = e.target.getAttribute('data-full-message');
                    if (hash && currentData) {
                        const commit = currentData.commits.find(c => c.hash === hash);
                        if (commit) {
                            // Override the message with the clicked message data
                            const messageCommit = {
                                ...commit,
                                message: messageText,
                                fullMessage: fullMessage
                            };
                            vscode.postMessage({
                                command: 'showCommitMessageDetails',
                                commit: messageCommit
                            });
                        }
                    }
                });
            });
            
            // Re-add mouse event listeners after graph update
            addMouseEventListeners();
        }
        
        function applyFilters() {
            const filters = {
                branch: '', // Disabled
                tag: '', // Disabled
                author: document.getElementById('authorFilter').value,
                message: document.getElementById('messageFilter').value,
                maxCommits: currentData?.filters?.maxCommits || 500,
                maxBranches: currentData?.filters?.maxBranches || 20
            };
            
            console.log('Applying filters:', filters);
            
            // Show loading status
            updateStatus('Applying filters...');
            
            vscode.postMessage({
                command: 'applyFilters',
                filters: filters
            });
        }
        
        function clearFilters() {
            document.getElementById('authorFilter').value = '';
            document.getElementById('messageFilter').value = '';
            
            // Clear any pending message filter timeout
            if (messageFilterTimeout) {
                clearTimeout(messageFilterTimeout);
                messageFilterTimeout = null;
            }
            
            applyFilters();
        }
        
        function zoomIn() {
            currentScale = Math.min(currentScale * 1.1, 3.0);
            applyZoom();
        }
        
        function zoomOut() {
            currentScale = Math.max(currentScale / 1.1, 0.5);
            applyZoom();
        }
        
        function resetView() {
            currentScale = 1.0;
            currentTranslate = { x: 0, y: 0 };
            applyZoom();
        }
        
        function applyZoom() {
            const svg = document.querySelector('.graph-svg');
            if (svg) {
                // Apply scale and translation
                svg.style.transform = \`translate(\${currentTranslate.x}px, \${currentTranslate.y}px) scale(\${currentScale})\`;
                svg.style.transformOrigin = 'center center';
                
                // Update container cursor based on zoom level
                const container = document.getElementById('graphContainer');
                if (currentScale > 1.0) {
                    container.style.cursor = 'grab';
                } else {
                    container.style.cursor = 'default';
                }
            }
        }
        
        function showLimitsDialog() {
            const maxCommits = currentData?.filters?.maxCommits || 500;
            const maxBranches = currentData?.filters?.maxBranches || 20;
            
            // Create a simple modal dialog
            const modal = document.createElement('div');
            modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; ' +
                'background-color: rgba(0, 0, 0, 0.5); display: flex; justify-content: center; ' +
                'align-items: center; z-index: 1000;';
            
            const dialog = document.createElement('div');
            dialog.style.cssText = 'background-color: var(--vscode-panel-background); ' +
                'border: 1px solid var(--vscode-panel-border); border-radius: 8px; ' +
                'padding: 20px; min-width: 300px;';
            
            dialog.innerHTML = '<h3 style="margin-top: 0; color: var(--vscode-foreground);">Set Limits</h3>' +
                '<div style="margin-bottom: 15px;">' +
                    '<label style="display: block; margin-bottom: 5px; color: var(--vscode-foreground);">Maximum commits:</label>' +
                    '<input type="number" id="commitsInput" value="' + maxCommits + '" min="1" max="10000" ' +
                           'style="width: 100%; padding: 8px; border: 1px solid var(--vscode-input-border); ' +
                                  'background-color: var(--vscode-input-background); ' +
                                  'color: var(--vscode-input-foreground); border-radius: 4px;">' +
                '</div>' +
                '<div style="margin-bottom: 20px;">' +
                    '<label style="display: block; margin-bottom: 5px; color: var(--vscode-foreground);">Maximum branches:</label>' +
                    '<input type="number" id="branchesInput" value="' + maxBranches + '" min="1" max="100" ' +
                           'style="width: 100%; padding: 8px; border: 1px solid var(--vscode-input-border); ' +
                                  'background-color: var(--vscode-input-background); ' +
                                  'color: var(--vscode-input-foreground); border-radius: 4px;">' +
                '</div>' +
                '<div style="display: flex; gap: 10px; justify-content: flex-end;">' +
                    '<button id="cancelBtn" class="btn" style="background-color: var(--vscode-button-secondaryBackground); ' +
                                                              'color: var(--vscode-button-secondaryForeground);">Cancel</button>' +
                    '<button id="applyBtn" class="btn">Apply</button>' +
                '</div>';
            
            modal.appendChild(dialog);
            document.body.appendChild(modal);
            
            // Focus on first input
            const commitsInput = dialog.querySelector('#commitsInput');
            commitsInput.focus();
            
            // Handle events
            const cancelBtn = dialog.querySelector('#cancelBtn');
            const applyBtn = dialog.querySelector('#applyBtn');
            
            const closeModal = () => {
                document.body.removeChild(modal);
            };
            
            cancelBtn.addEventListener('click', closeModal);
            applyBtn.addEventListener('click', () => {
                const commitsValue = parseInt(commitsInput.value) || 500;
                const branchesValue = parseInt(dialog.querySelector('#branchesInput').value) || 20;
                
                const filters = {
                    ...currentData?.filters,
                    maxCommits: commitsValue,
                    maxBranches: branchesValue
                };
                
                vscode.postMessage({
                    command: 'applyFilters',
                    filters: filters
                });
                
                closeModal();
            });
            
            // Close on escape key
            modal.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    closeModal();
                }
            });
            
            // Close on backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeModal();
                }
            });
        }
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateStatus':
                    updateStatus(message.status);
                    break;
                case 'updateGitData':
                    updateGitData(message);
                    break;
                case 'updateGraphProgress':
                    updateGraphProgress(message);
                    break;
                case 'zoomIn':
                    zoomIn();
                    break;
                case 'zoomOut':
                    zoomOut();
                    break;
            }
        });
        
        // Mouse wheel zoom functionality
        function handleWheelZoom(event) {
            event.preventDefault();
            
            const delta = event.deltaY;
            const zoomFactor = 0.1;
            const oldScale = currentScale;
            
            if (delta < 0) {
                // Zoom in
                currentScale = Math.min(currentScale * (1 + zoomFactor), 3.0);
            } else {
                // Zoom out
                currentScale = Math.max(currentScale * (1 - zoomFactor), 0.5);
            }
            
            // Adjust translation to zoom towards mouse position
            const rect = event.target.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;
            
            const scaleChange = currentScale / oldScale;
            currentTranslate.x = mouseX - (mouseX - currentTranslate.x) * scaleChange;
            currentTranslate.y = mouseY - (mouseY - currentTranslate.y) * scaleChange;
            
            applyZoom();
        }
        
        // Mouse drag functionality
        function handleMouseDown(event) {
            if (event.button === 0 && currentScale > 1.0) { // Left mouse button and zoomed in
                isDragging = true;
                dragStart.x = event.clientX - currentTranslate.x;
                dragStart.y = event.clientY - currentTranslate.y;
                
                // Change cursor to indicate dragging
                const container = document.getElementById('graphContainer');
                container.style.cursor = 'grabbing';
                
                event.preventDefault();
            }
        }
        
        function handleMouseMove(event) {
            if (isDragging) {
                currentTranslate.x = event.clientX - dragStart.x;
                currentTranslate.y = event.clientY - dragStart.y;
                applyZoom();
            }
        }
        
        function handleMouseUp(event) {
            if (event.button === 0) { // Left mouse button
                isDragging = false;
                const container = document.getElementById('graphContainer');
                if (currentScale > 1.0) {
                    container.style.cursor = 'grab';
                } else {
                    container.style.cursor = 'default';
                }
            }
        }
        
        // Add event listeners for mouse interactions
        function addMouseEventListeners() {
            const graphContainer = document.getElementById('graphContainer');
            
            // Wheel zoom
            graphContainer.addEventListener('wheel', handleWheelZoom, { passive: false });
            
            // Mouse drag
            graphContainer.addEventListener('mousedown', handleMouseDown);
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            
            // Prevent context menu on right click
            graphContainer.addEventListener('contextmenu', (e) => e.preventDefault());
        }
        
        // Initialize mouse event listeners when the page loads
        document.addEventListener('DOMContentLoaded', addMouseEventListeners);
        
        // Load initial data
        vscode.postMessage({ command: 'loadGitData' });
    </script>
</body>
</html>`;
}

export function deactivate() {
	if (currentPanel) {
		currentPanel.dispose();
	}
}
