import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export interface GitCommit {
    hash: string;
    shortHash: string;
    author: string;
    authorEmail: string;
    message: string;
    fullMessage: string;
    date: Date;
    parents: string[];
    refs: string[];
}

export interface GitBranch {
    name: string;
    isCurrent: boolean;
}

export interface GitTag {
    name: string;
    commit: string;
}

export interface GitFilters {
    branch?: string;
    tag?: string;
    author?: string;
    message?: string;
    maxCommits?: number;
    maxBranches?: number;
}

export class GitService {
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    async isGitRepository(): Promise<boolean> {
        try {
            const gitDir = path.join(this.workspaceRoot, '.git');
            return fs.existsSync(gitDir);
        } catch (error) {
            return false;
        }
    }

    async getCommits(filters: GitFilters = {}): Promise<GitCommit[]> {
        try {
            console.log('GitService: Getting commits...');
            
            // Use the simplest possible git command
            const command = 'git log --oneline -5';
            console.log('GitService: Executing command:', command);
            
            const timeoutMs = 2000; // 2 second timeout
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Git log command timed out')), timeoutMs);
            });
            
            const gitPromise = execAsync(command, { 
                cwd: this.workspaceRoot,
                encoding: 'utf8',
                maxBuffer: 1024 * 1024 // 1MB buffer
            });
            
            const { stdout, stderr } = await Promise.race([gitPromise, timeoutPromise]);
            
            if (stderr) {
                console.warn('Git command stderr:', stderr);
            }
            
            console.log('GitService: Raw output:', stdout);
            console.log('GitService: Parsing commits...');
            
            const commits: GitCommit[] = [];
            const lines = stdout.trim().split('\n');
            
            for (const line of lines) {
                if (!line.trim()) continue;
                
                // Simple parsing for --oneline format: "hash message"
                const spaceIndex = line.indexOf(' ');
                if (spaceIndex > 0) {
                    const hash = line.substring(0, spaceIndex);
                    const message = line.substring(spaceIndex + 1);
                    
                    commits.push({
                        hash: hash,
                        shortHash: hash.substring(0, 7),
                        author: 'Unknown',
                        authorEmail: '',
                        message: message,
                        fullMessage: message,
                        date: new Date(),
                        parents: [],
                        refs: []
                    });
                }
            }
            
            console.log('GitService: Parsed', commits.length, 'commits');
            return commits;
            
        } catch (error) {
            console.error('Error getting commits:', error);
            return [];
        }
    }

    async getBranches(): Promise<GitBranch[]> {
        try {
            console.log('GitService: Getting branches...');
            const timeoutMs = 2000; // 2 second timeout
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Git branch command timed out')), timeoutMs);
            });
            
            const gitPromise = execAsync('git branch', { 
                cwd: this.workspaceRoot,
                encoding: 'utf8',
                maxBuffer: 1024 * 1024 // 1MB buffer
            });
            
            const { stdout, stderr } = await Promise.race([gitPromise, timeoutPromise]);
            
            if (stderr) {
                console.warn('Git branch stderr:', stderr);
            }
            
            console.log('GitService: Parsing branches...');
            const branches: GitBranch[] = [];
            const lines = stdout.trim().split('\n');
            
            for (const line of lines) {
                if (!line.trim()) continue;
                
                const isCurrent = line.startsWith('*');
                const name = line.replace(/^\*\s*/, '').trim();
                
                if (name) {
                    branches.push({
                        name: name,
                        isCurrent: isCurrent
                    });
                }
            }
            
            return branches;
            
        } catch (error) {
            console.error('Error getting branches:', error);
            return [];
        }
    }

    async getTags(): Promise<GitTag[]> {
        try {
            console.log('GitService: Getting tags...');
            // Return empty for now to avoid hanging
            return [];
        } catch (error) {
            console.error('Error getting tags:', error);
            return [];
        }
    }

    async getAuthors(): Promise<string[]> {
        try {
            console.log('GitService: Getting authors...');
            // Return empty for now to avoid hanging
            return [];
        } catch (error) {
            console.error('Error getting authors:', error);
            return [];
        }
    }

    async getFileChanges(hash: string): Promise<any[]> {
        try {
            console.log('GitService: Getting file changes...');
            // Return empty for now to avoid hanging
            return [];
        } catch (error) {
            console.error('Error getting file changes:', error);
            return [];
        }
    }

    clearCache(): void {
        // No cache implementation for now
    }
}

class GitVizViewProvider implements vscode.TreeDataProvider<GitVizItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<GitVizItem | undefined | null | void> = new vscode.EventEmitter<GitVizItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<GitVizItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private extensionUri: vscode.Uri) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: GitVizItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: GitVizItem): Thenable<GitVizItem[]> {
        if (!element) {
            return Promise.resolve([
                new GitVizItem('Open Git Visualization', 'Open the git visualization panel', vscode.TreeItemCollapsibleState.None, {
                    command: 'git-viz.open',
                    title: 'Open Git Visualization'
                })
            ]);
        }
        return Promise.resolve([]);
    }
}

class GitVizItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
        this.tooltip = description;
        this.description = description;
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Git Viz extension is now active!');

    // Register the view provider
    const provider = new GitVizViewProvider(context.extensionUri);
    const view = vscode.window.createTreeView('git-viz-view', {
        treeDataProvider: provider,
        showCollapseAll: false
    });

    // Register commands
    const openCommand = vscode.commands.registerCommand('git-viz.open', () => {
        openGitVisualization(context);
    });

    const refreshCommand = vscode.commands.registerCommand('git-viz.refresh', () => {
        refreshGitVisualization();
    });

    const zoomInCommand = vscode.commands.registerCommand('git-viz.zoomIn', () => {
        zoomIn();
    });

    const zoomOutCommand = vscode.commands.registerCommand('git-viz.zoomOut', () => {
        zoomOut();
    });

    context.subscriptions.push(view, openCommand, refreshCommand, zoomInCommand, zoomOutCommand);
}

let currentPanel: vscode.WebviewPanel | undefined;
let currentGitService: GitService | undefined;
let currentFilters: GitFilters = {
    maxCommits: 20,
    maxBranches: 5
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

        // Get git data
        const [commits, branches, tags, authors] = await Promise.all([
            currentGitService.getCommits(currentFilters),
            currentGitService.getBranches(),
            currentGitService.getTags(),
            currentGitService.getAuthors()
        ]);

        // Send data to webview
        currentPanel.webview.postMessage({
            command: 'updateGitData',
            commits,
            branches,
            tags,
            authors,
            filters: currentFilters,
            status: `Showing ${commits.length} commits • ${branches.length} branches`
        });

    } catch (error) {
        console.error('Error during git data loading:', error);
        if (currentPanel) {
            currentPanel.webview.postMessage({
                command: 'updateStatus',
                status: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        }
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
    const message = `Commit: ${commit.shortHash}\nAuthor: ${commit.author}\nDate: ${commit.date}\nMessage: ${commit.message}`;
    vscode.window.showInformationMessage(message);
}

function showAuthorDetails(author: string, authorEmail: string) {
    const message = `Author: ${author}\nEmail: ${authorEmail}`;
    vscode.window.showInformationMessage(message);
}

function showCommitMessageDetails(commit: any) {
    const message = `Commit: ${commit.shortHash}\nMessage: ${commit.fullMessage}`;
    vscode.window.showInformationMessage(message);
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
            updateBranchFilter(data.branches || []);
            updateTagFilter(data.tags || []);
            updateAuthorFilter(data.authors || []);
            
            // Set up message filter with debouncing
            setupMessageFilter();
            
            // Render graph
            renderGraph(data.commits || []);
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
        
        function renderGraph(commits) {
            const container = document.getElementById('graphContainer');
            
            if (commits.length === 0) {
                container.innerHTML = '<div class="error">No commits found</div>';
                return;
            }
            
            // Reverse commits to show newest first (left to right)
            const reversedCommits = [...commits].reverse();
            
            // Assign branches to commits and create branch-to-color mapping
            const branchColors = {};
            const commitBranches = {};
            const branchLanes = {};
            let nextLane = 0;
            let nextColorIndex = 0;
            
            // Colors for different branches
            const colors = ['#1A73E8', '#34A853', '#FBBC05', '#E91E63', '#00ACC1', '#8E24AA', '#F4511E', '#7CB342'];
            
            // Process commits to assign branches and colors
            reversedCommits.forEach(commit => {
                // Extract branch names from refs
                const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
                const branchNames = branchRefs.map(ref => ref.replace('Branch ', ''));
                
                if (branchNames.length > 0) {
                    // Use the first branch name found
                    const branchName = branchNames[0];
                    commitBranches[commit.hash] = branchName;
                    
                    // Assign color to branch if not already assigned
                    if (!branchColors[branchName]) {
                        branchColors[branchName] = colors[nextColorIndex % colors.length];
                        branchLanes[branchName] = nextLane;
                        nextColorIndex++;
                        nextLane++;
                    }
                } else {
                    // No branch refs - assign to a default branch
                    const defaultBranch = 'main';
                    commitBranches[commit.hash] = defaultBranch;
                    if (!branchColors[defaultBranch]) {
                        branchColors[defaultBranch] = colors[0]; // Blue for main
                        branchLanes[defaultBranch] = 0;
                    }
                }
            });
            
            // Create SVG
            const maxLanes = Math.max(Object.keys(branchLanes).length, 1);
            const width = 100 + reversedCommits.length * 180;
            const height = 200 + maxLanes * 80;
            
            let svg = \`
                <svg class="graph-svg" width="\${width}" height="\${height}" 
                     viewBox="0 0 \${width} \${height}" 
                     style="background: #1e1e1e; font-family: 'Segoe UI', sans-serif;">
                    
                    <defs>
                        <marker id="arrowhead" markerWidth="10" markerHeight="7" 
                                refX="9" refY="3.5" orient="auto">
                            <polygon points="0 0, 10 3.5, 0 7" fill="currentColor"/>
                        </marker>
                    </defs>
                    
                    <style>
                        .commit-text { fill: #ffffff; font-size: 12px; }
                        .commit-node:hover { stroke-width: 3; }
                        .branch-label { fill: #ffffff; font-size: 10px; font-weight: bold; }
                    </style>
            \`;
            
            // Render commits
            reversedCommits.forEach((commit, index) => {
                const x = 50 + index * 180;
                const branchName = commitBranches[commit.hash] || 'main';
                const lane = branchLanes[branchName] || 0;
                const y = 100 + lane * 80;
                const color = branchColors[branchName] || colors[0];
                
                // Draw connection to previous commit
                if (index > 0) {
                    const prevCommit = reversedCommits[index - 1];
                    const prevBranchName = commitBranches[prevCommit.hash] || 'main';
                    const prevLane = branchLanes[prevBranchName] || 0;
                    const prevX = 50 + (index - 1) * 180;
                    const prevY = 100 + prevLane * 80;
                    
                    // Use the current commit's color for the line
                    svg += \`
                        <path d="M \${prevX} \${prevY} L \${x} \${y}" 
                              stroke="\${color}" 
                              stroke-width="2" 
                              fill="none" 
                              opacity="0.8"
                              marker-end="url(#arrowhead)"/>
                    \`;
                }
                
                // Draw commit node
                svg += \`
                    <circle cx="\${x}" cy="\${y}" r="7" 
                            fill="\${color}" stroke="white" stroke-width="2" 
                            class="commit-node" data-hash="\${commit.hash}"/>
                \`;
                
                // Draw commit info with author
                svg += \`
                    <text x="\${x}" y="\${y - 20}" class="commit-text" text-anchor="middle" data-hash="\${commit.hash}" data-type="sha">
                        \${commit.shortHash}
                    </text>
                    <text x="\${x}" y="\${y - 5}" class="commit-text" text-anchor="middle" data-hash="\${commit.hash}" data-type="author" style="font-size: 10px; fill: #cccccc;">
                        \${truncateText(commit.author, 15)}
                    </text>
                    <text x="\${x}" y="\${y + 30}" class="commit-text" text-anchor="middle" data-hash="\${commit.hash}" data-type="message">
                        \${truncateText(commit.message, 20)}
                    </text>
                \`;
                
                // Draw branch labels and tags
                const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
                const tagRefs = commit.refs.filter(ref => ref.startsWith('Tag '));
                
                let labelY = y - 40;
                
                // Show branch names
                branchRefs.forEach((ref, idx) => {
                    const branchName = ref.replace('Branch ', '');
                    svg += \`
                        <text x="\${x}" y="\${labelY}" class="branch-label" text-anchor="middle" data-hash="\${commit.hash}" data-type="branch">
                            \${branchName}
                        </text>
                    \`;
                    labelY -= 15;
                });
                
                // Show tags
                tagRefs.forEach((ref, idx) => {
                    const tagName = ref.replace('Tag ', '');
                    svg += \`
                        <text x="\${x}" y="\${labelY}" class="branch-label" text-anchor="middle" data-hash="\${commit.hash}" data-type="tag" style="fill: #ffd700;">
                            \${tagName}
                        </text>
                    \`;
                    labelY -= 15;
                });
            });
            
            svg += '</svg>';
            
            container.innerHTML = svg;
            
            // Add click handlers for nodes and text elements
            const clickableElements = container.querySelectorAll('.commit-node, [data-hash]');
            clickableElements.forEach(element => {
                element.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const hash = e.target.getAttribute('data-hash');
                    const type = e.target.getAttribute('data-type');
                    
                    if (hash && currentData) {
                        const commit = currentData.commits.find(c => c.hash === hash);
                        if (commit) {
                            if (type === 'author') {
                                showAuthorPopup(commit, e);
                            } else if (type === 'message') {
                                showMessagePopup(commit, e);
                            } else {
                                showCommitDetailsPopup(commit, e);
                            }
                        }
                    }
                });
                
                // Add hover effects
                element.addEventListener('mouseenter', (e) => {
                    e.target.style.cursor = 'pointer';
                    if (e.target.tagName === 'text') {
                        e.target.style.fill = '#ffffff';
                    }
                });
                
                element.addEventListener('mouseleave', (e) => {
                    e.target.style.cursor = 'default';
                    if (e.target.tagName === 'text') {
                        const type = e.target.getAttribute('data-type');
                        if (type === 'author') {
                            e.target.style.fill = '#cccccc';
                        } else {
                            e.target.style.fill = '#ffffff';
                        }
                    }
                });
            });
            
            // Re-add mouse event listeners
            addMouseEventListeners();
        }
        
        function truncateText(text, maxLength) {
            if (text.length <= maxLength) return text;
            return text.substring(0, maxLength - 3) + '...';
        }
        
        function showAuthorPopup(commit, event) {
            const popup = document.createElement('div');
            popup.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; ' +
                'background-color: rgba(0, 0, 0, 0.5); display: flex; justify-content: center; ' +
                'align-items: center; z-index: 1000;';
            
            const dialog = document.createElement('div');
            dialog.style.cssText = 'background-color: var(--vscode-panel-background); ' +
                'border: 1px solid var(--vscode-panel-border); border-radius: 8px; ' +
                'padding: 20px; min-width: 300px; max-width: 500px;';
            
            dialog.innerHTML = '<h3 style="margin-top: 0; color: var(--vscode-foreground);">Author Information</h3>' +
                '<div style="margin-bottom: 15px;">' +
                    '<label style="display: block; margin-bottom: 5px; color: var(--vscode-foreground); font-weight: bold;">Name:</label>' +
                    '<div style="padding: 8px; background-color: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; color: var(--vscode-input-foreground);">' + commit.author + '</div>' +
                '</div>' +
                '<div style="margin-bottom: 15px;">' +
                    '<label style="display: block; margin-bottom: 5px; color: var(--vscode-foreground); font-weight: bold;">Email:</label>' +
                    '<div style="padding: 8px; background-color: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; color: var(--vscode-input-foreground);">' + (commit.authorEmail || 'No email') + '</div>' +
                '</div>' +
                '<div style="margin-bottom: 20px;">' +
                    '<label style="display: block; margin-bottom: 5px; color: var(--vscode-foreground); font-weight: bold;">Commit:</label>' +
                    '<div style="padding: 8px; background-color: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; color: var(--vscode-input-foreground); font-family: monospace;">' + commit.shortHash + '</div>' +
                '</div>' +
                '<div style="display: flex; gap: 10px; justify-content: flex-end;">' +
                    '<button class="btn" onclick="this.closest(\'.popup-overlay\').remove()">Close</button>' +
                '</div>';
            
            popup.className = 'popup-overlay';
            popup.appendChild(dialog);
            document.body.appendChild(popup);
            
            // Close on escape key
            popup.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    popup.remove();
                }
            });
            
            // Close on backdrop click
            popup.addEventListener('click', (e) => {
                if (e.target === popup) {
                    popup.remove();
                }
            });
        }
        
        function showMessagePopup(commit, event) {
            const popup = document.createElement('div');
            popup.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; ' +
                'background-color: rgba(0, 0, 0, 0.5); display: flex; justify-content: center; ' +
                'align-items: center; z-index: 1000;';
            
            const dialog = document.createElement('div');
            dialog.style.cssText = 'background-color: var(--vscode-panel-background); ' +
                'border: 1px solid var(--vscode-panel-border); border-radius: 8px; ' +
                'padding: 20px; min-width: 400px; max-width: 600px;';
            
            dialog.innerHTML = '<h3 style="margin-top: 0; color: var(--vscode-foreground);">Commit Message</h3>' +
                '<div style="margin-bottom: 15px;">' +
                    '<label style="display: block; margin-bottom: 5px; color: var(--vscode-foreground); font-weight: bold;">Commit:</label>' +
                    '<div style="padding: 8px; background-color: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; color: var(--vscode-input-foreground); font-family: monospace;">' + commit.shortHash + '</div>' +
                '</div>' +
                '<div style="margin-bottom: 15px;">' +
                    '<label style="display: block; margin-bottom: 5px; color: var(--vscode-foreground); font-weight: bold;">Author:</label>' +
                    '<div style="padding: 8px; background-color: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; color: var(--vscode-input-foreground);">' + commit.author + '</div>' +
                '</div>' +
                '<div style="margin-bottom: 20px;">' +
                    '<label style="display: block; margin-bottom: 5px; color: var(--vscode-foreground); font-weight: bold;">Full Message:</label>' +
                    '<div style="padding: 12px; background-color: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; color: var(--vscode-input-foreground); max-height: 200px; overflow-y: auto; white-space: pre-wrap;">' + (commit.fullMessage || commit.message) + '</div>' +
                '</div>' +
                '<div style="display: flex; gap: 10px; justify-content: flex-end;">' +
                    '<button class="btn" onclick="this.closest(\'.popup-overlay\').remove()">Close</button>' +
                '</div>';
            
            popup.className = 'popup-overlay';
            popup.appendChild(dialog);
            document.body.appendChild(popup);
            
            // Close on escape key
            popup.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    popup.remove();
                }
            });
            
            // Close on backdrop click
            popup.addEventListener('click', (e) => {
                if (e.target === popup) {
                    popup.remove();
                }
            });
        }
        
        function showCommitDetailsPopup(commit, event) {
            const popup = document.createElement('div');
            popup.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; ' +
                'background-color: rgba(0, 0, 0, 0.5); display: flex; justify-content: center; ' +
                'align-items: center; z-index: 1000;';
            
            const dialog = document.createElement('div');
            dialog.style.cssText = 'background-color: var(--vscode-panel-background); ' +
                'border: 1px solid var(--vscode-panel-border); border-radius: 8px; ' +
                'padding: 20px; min-width: 400px; max-width: 600px;';
            
            const refs = commit.refs.map(ref => {
                if (ref.startsWith('Branch ')) {
                    return '<span style="background-color: #34A853; color: white; padding: 2px 6px; border-radius: 3px; margin: 2px; display: inline-block;">' + ref.replace('Branch ', '') + '</span>';
                } else if (ref.startsWith('Tag ')) {
                    return '<span style="background-color: #FFD700; color: black; padding: 2px 6px; border-radius: 3px; margin: 2px; display: inline-block;">' + ref.replace('Tag ', '') + '</span>';
                }
                return ref;
            }).join('');
            
            dialog.innerHTML = '<h3 style="margin-top: 0; color: var(--vscode-foreground);">Commit Details</h3>' +
                '<div style="margin-bottom: 15px;">' +
                    '<label style="display: block; margin-bottom: 5px; color: var(--vscode-foreground); font-weight: bold;">Hash:</label>' +
                    '<div style="padding: 8px; background-color: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; color: var(--vscode-input-foreground); font-family: monospace;">' + commit.hash + '</div>' +
                '</div>' +
                '<div style="margin-bottom: 15px;">' +
                    '<label style="display: block; margin-bottom: 5px; color: var(--vscode-foreground); font-weight: bold;">Author:</label>' +
                    '<div style="padding: 8px; background-color: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; color: var(--vscode-input-foreground);">' + commit.author + ' &lt;' + (commit.authorEmail || 'no-email') + '&gt;</div>' +
                '</div>' +
                '<div style="margin-bottom: 15px;">' +
                    '<label style="display: block; margin-bottom: 5px; color: var(--vscode-foreground); font-weight: bold;">Date:</label>' +
                    '<div style="padding: 8px; background-color: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; color: var(--vscode-input-foreground);">' + new Date(commit.date).toLocaleString() + '</div>' +
                '</div>' +
                '<div style="margin-bottom: 15px;">' +
                    '<label style="display: block; margin-bottom: 5px; color: var(--vscode-foreground); font-weight: bold;">Message:</label>' +
                    '<div style="padding: 12px; background-color: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; color: var(--vscode-input-foreground); max-height: 150px; overflow-y: auto; white-space: pre-wrap;">' + (commit.fullMessage || commit.message) + '</div>' +
                '</div>' +
                (refs ? '<div style="margin-bottom: 20px;">' +
                    '<label style="display: block; margin-bottom: 5px; color: var(--vscode-foreground); font-weight: bold;">References:</label>' +
                    '<div style="padding: 8px; background-color: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px;">' + refs + '</div>' +
                '</div>' : '') +
                '<div style="display: flex; gap: 10px; justify-content: flex-end;">' +
                    '<button class="btn" onclick="this.closest(\'.popup-overlay\').remove()">Close</button>' +
                '</div>';
            
            popup.className = 'popup-overlay';
            popup.appendChild(dialog);
            document.body.appendChild(popup);
            
            // Close on escape key
            popup.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    popup.remove();
                }
            });
            
            // Close on backdrop click
            popup.addEventListener('click', (e) => {
                if (e.target === popup) {
                    popup.remove();
                }
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
            
            // Show loading status
            updateStatus('Applying filters...');
            
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

export function deactivate() {}
