import * as vscode from 'vscode';
import { GitService, GitFilters } from './gitService';
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
let currentFilters: GitFilters = {
	maxCommits: 500,
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

		// Get git data
		const [commits, branches, tags, authors] = await Promise.all([
			currentGitService.getCommits(currentFilters),
			currentGitService.getBranches(),
			currentGitService.getTags(),
			currentGitService.getAuthors()
		]);

		// Create graph renderer
		const renderer = new HorizontalGraphRenderer(commits);
		const graphSvg = renderer.render();

		// Send data to webview
		currentPanel.webview.postMessage({
			command: 'updateGitData',
			commits,
			branches,
			tags,
			authors,
			graphSvg,
			filters: currentFilters,
			status: `Showing ${commits.length} commits • ${branches.length} branches`
		});

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

function showCommitDetails(commit: any) {
	const message = vscode.window.createWebviewPanel(
		'commitDetails',
		`Commit ${commit.shortHash}`,
		vscode.ViewColumn.Two,
		{ enableScripts: true }
	);

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
		</body>
		</html>
	`;
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

function showCommitMessageDetails(commit: any) {
	const message = vscode.window.createWebviewPanel(
		'commitMessageDetails',
		`Commit Message: ${commit.shortHash}`,
		vscode.ViewColumn.Two,
		{ enableScripts: true }
	);

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
        }
        
        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
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
    </style>
</head>
<body>
    <div class="container">
        <div class="toolbar">
            <div class="status" id="status">Loading...</div>
            <div class="controls">
                <button class="btn" onclick="showLimitsDialog()">Limits…</button>
                <button class="btn" onclick="zoomOut()">-</button>
                <button class="btn" onclick="zoomIn()">+</button>
            </div>
        </div>
        
        <div class="filters">
            <div class="filter-group">
                <label>Branch:</label>
                <select id="branchFilter">
                    <option value="">All branches</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Tag:</label>
                <select id="tagFilter">
                    <option value="">All tags</option>
                </select>
            </div>
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
            <button class="btn" onclick="applyFilters()">Apply</button>
            <button class="btn" onclick="clearFilters()">Clear</button>
        </div>
        
        <div class="graph-container" id="graphContainer">
            <div class="loading">Loading git data...</div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        let currentScale = 1.0;
        let currentData = null;
        
        function updateStatus(message) {
            document.getElementById('status').textContent = message;
        }
        
        function updateGitData(data) {
            currentData = data;
            
            // Update status
            updateStatus(data.status || 'Ready');
            
            // Update filter dropdowns
            updateBranchFilter(data.branches || []);
            updateTagFilter(data.tags || []);
            updateAuthorFilter(data.authors || []);
            
            // Update graph
            updateGraph(data.graphSvg);
        }
        
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
        }
        
        function updateAuthorFilter(authors) {
            const select = document.getElementById('authorFilter');
            select.innerHTML = '<option value="">All authors</option>';
            authors.forEach(author => {
                const option = document.createElement('option');
                option.value = author;
                option.textContent = author;
                select.appendChild(option);
            });
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
        }
        
        function applyFilters() {
            const filters = {
                branch: document.getElementById('branchFilter').value,
                tag: document.getElementById('tagFilter').value,
                author: document.getElementById('authorFilter').value,
                message: document.getElementById('messageFilter').value,
                maxCommits: currentData?.filters?.maxCommits || 500,
                maxBranches: currentData?.filters?.maxBranches || 20
            };
            
            vscode.postMessage({
                command: 'applyFilters',
                filters: filters
            });
        }
        
        function clearFilters() {
            document.getElementById('branchFilter').value = '';
            document.getElementById('tagFilter').value = '';
            document.getElementById('authorFilter').value = '';
            document.getElementById('messageFilter').value = '';
            applyFilters();
        }
        
        function zoomIn() {
            currentScale = Math.min(currentScale * 1.1, 3.0);
            applyZoom();
            vscode.postMessage({ command: 'zoomIn' });
        }
        
        function zoomOut() {
            currentScale = Math.max(currentScale / 1.1, 0.5);
            applyZoom();
            vscode.postMessage({ command: 'zoomOut' });
        }
        
        function applyZoom() {
            const svg = document.querySelector('.graph-svg');
            if (svg) {
                svg.style.transform = \`scale(\${currentScale})\`;
                svg.style.transformOrigin = 'center center';
            }
        }
        
        function showLimitsDialog() {
            const maxCommits = currentData?.filters?.maxCommits || 500;
            const maxBranches = currentData?.filters?.maxBranches || 20;
            
            const commitsInput = prompt('Maximum commits to show:', maxCommits.toString());
            const branchesInput = prompt('Maximum branches to show:', maxBranches.toString());
            
            if (commitsInput !== null && branchesInput !== null) {
                const filters = {
                    ...currentData?.filters,
                    maxCommits: parseInt(commitsInput) || 500,
                    maxBranches: parseInt(branchesInput) || 20
                };
                
                vscode.postMessage({
                    command: 'applyFilters',
                    filters: filters
                });
            }
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
                case 'zoomIn':
                    zoomIn();
                    break;
                case 'zoomOut':
                    zoomOut();
                    break;
            }
        });
        
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
