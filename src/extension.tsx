import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { webviewStyles } from './webview';

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


export interface GitFilters {
    branch?: string;
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

    private async executeGitCommand(command: string, timeoutMs: number = 30000): Promise<{ stdout: string, stderr: string }> {
        console.log('GitService: Executing command:', command, 'in directory:', this.workspaceRoot);
        
        const gitPromise = execAsync(command, {
            cwd: this.workspaceRoot,
            encoding: 'utf8',
            maxBuffer: 50 * 1024 * 1024, // 50MB buffer
            env: {
                ...process.env,
                GIT_PAGER: 'cat',
                PAGER: 'cat',
                GIT_TERMINAL_PROMPT: '0',
                TERM: 'dumb'
            }
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Git command timed out after ${timeoutMs}ms: ${command}`)), timeoutMs);
        });

        try {
            const result = await Promise.race([gitPromise, timeoutPromise]);
            console.log('GitService: Command completed successfully');
            console.log('GitService: Output length:', result.stdout.length, 'Error length:', result.stderr.length);
            if (result.stderr) {
                console.log('GitService: Stderr:', result.stderr.substring(0, 500));
            }
            return result;
        } catch (error) {
            console.error('GitService: Command failed:', error);
            console.error('GitService: Error details:', error instanceof Error ? error.message : 'Unknown error');
            throw error;
        }
    }

    async getCommits(filters: GitFilters = {}): Promise<GitCommit[]> {
        try {
            console.log('GitService: Getting commits with filters:', filters);

            const maxCommits = filters.maxCommits || 500;
            const branch = filters.branch || '--all';
            
            const format = `"%H|%h|%an|%ae|%ad|%p|%d"`;
            const command = `git log ${branch} --max-count=${maxCommits} --pretty=format:${format} --date=iso`;

            console.log('GitService: Executing command:', command);
            const { stdout, stderr } = await this.executeGitCommand(command, 10000);

            if (stderr) {
                console.warn('Git command stderr:', stderr);
            }

            console.log('GitService: Parsing commits...');
            const commits: GitCommit[] = [];
            const lines = stdout.trim().split('\n');

            for (const line of lines) {
                if (!line.trim()) continue;

                // Parse the line properly handling quoted fields
                const parts: string[] = [];
                let current = '';
                let inQuotes = false;
                let i = 0;
                
                while (i < line.length) {
                    const char = line[i];
                    
                    if (char === '"') {
                        if (inQuotes && line[i + 1] === '"') {
                            // Escaped quote
                            current += '"';
                            i += 2;
                        } else {
                            // Toggle quote state
                            inQuotes = !inQuotes;
                            i++;
                        }
                    } else if (char === '|' && !inQuotes) {
                        // Field separator
                        parts.push(current);
                        current = '';
                        i++;
                    } else {
                        current += char;
                        i++;
                    }
                }
                
                // Add the last part
                if (current !== '') {
                    parts.push(current);
                }

                if (parts.length < 7) continue;

                const [hash, shortHash, author, authorEmail, date, parentHashes, refsRaw] = parts;
                
                const parents = parentHashes ? parentHashes.split(' ') : [];
                
                const refs = refsRaw
                    ? refsRaw
                        .trim()
                        .replace(/[()]/g, '')
                        .split(',')
                        .map(ref => {
                            const trimmedRef = ref.trim();
                            if (trimmedRef.startsWith('HEAD -> ')) {
                                return `Branch ${trimmedRef.replace('HEAD -> ', '')}`;
                            }
                            if (trimmedRef.startsWith('tag: ')) {
                                return `Tag ${trimmedRef.replace('tag: ', '')}`;
                            }
                            if (trimmedRef) {
                                return `Branch ${trimmedRef}`;
                            }
                            return null;
                        })
                        .filter((ref): ref is string => !!ref)
                    : [];

                commits.push({
                    hash,
                    shortHash,
                    author,
                    authorEmail,
                    message: '',
                    fullMessage: '',
                    date: new Date(date),
                    parents,
                    refs
                });
            }

            const commitMessages = await this.getCommitMessages(commits.map(c => c.hash));
            commits.forEach(commit => {
                const msg = commitMessages[commit.hash];
                if (msg) {
                    commit.message = msg.subject;
                    commit.fullMessage = msg.body;
                }
            });

            console.log('GitService: Parsed', commits.length, 'commits');
            return commits;

        } catch (error) {
            console.error('Error getting commits:', error);
            console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
            console.error('Error message:', error instanceof Error ? error.message : 'Unknown error');
            throw error; // Re-throw to let the caller handle it
        }
    }
    
    private async getCommitMessages(hashes: string[]): Promise<{ [hash: string]: { subject: string, body: string } }> {
        if (hashes.length === 0) return {};

        const command = `git show --no-patch --pretty=format:"%H%n%s%n%b" ${hashes.join(' ')}`;
        const { stdout } = await this.executeGitCommand(command, 10000);

        const messages: { [hash: string]: { subject: string, body: string } } = {};
        const commitsRaw = stdout.split(/(?=\b[0-9a-f]{40}\b)/g);

        for (const commitRaw of commitsRaw) {
            if (!commitRaw.trim()) continue;
            
            const lines = commitRaw.trim().split('\n');
            const hash = lines[0];
            const subject = lines[1] || '';
            const body = lines.slice(2).join('\n').trim();
            
            messages[hash] = { subject, body };
        }
        
        return messages;
    }


    async getBranches(): Promise<GitBranch[]> {
        try {
            console.log('GitService: Getting branches...');
            const { stdout, stderr } = await this.executeGitCommand('git branch -a', 5000);

            if (stderr) {
                console.warn('Git branch stderr:', stderr);
            }

            console.log('GitService: Parsing branches...');
            const branches: GitBranch[] = [];
            const lines = stdout.trim().split('\n');

            for (const line of lines) {
                if (!line.trim() || line.includes('->')) continue;

                const isCurrent = line.startsWith('*');
                const name = line.replace(/^[\*\s]+/, '').replace(/^remotes\//, '').trim();

                if (name && !branches.some(b => b.name === name)) {
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


    async getAuthors(): Promise<string[]> {
        try {
            console.log('GitService: Getting authors...');
            const { stdout, stderr } = await this.executeGitCommand('git log --all --pretty=format:"%an"');

            if (stderr) {
                console.warn('Git authors stderr:', stderr);
            }

            const authors = [...new Set(stdout.trim().split('\n'))].sort();
            return authors;

        } catch (error) {
            console.error('Error getting authors:', error);
            return [];
        }
    }

    async getFileChanges(hash: string): Promise<any[]> {
        try {
            console.log('GitService: Getting file changes for', hash);
            const command = `git show --name-status --pretty="" ${hash}`;
            const { stdout } = await this.executeGitCommand(command, 5000);
            
            const changes = stdout.trim().split('\n').map(line => {
                const [status, file] = line.split('\t');
                return { status, file };
            });
            
            return changes;

        } catch (error) {
            console.error('Error getting file changes:', error);
            return [];
        }
    }

    clearCache(): void {
    }
}


export function activate(context: vscode.ExtensionContext) {
    console.log('Git Viz extension is now active!');
    console.log('Extension URI:', context.extensionUri.toString());

    const testCommand = vscode.commands.registerCommand('git-viz.test', async () => {
        console.log('git-viz.test command triggered');
        vscode.window.showInformationMessage('Git Viz extension is working!');
        
        // Test git commands
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceRoot) {
            try {
                console.log('Testing GitService with workspace:', workspaceRoot);
                const gitService = new GitService(workspaceRoot);
                
                console.log('Checking if git repository...');
                const isGit = await gitService.isGitRepository();
                console.log('Git repository check result:', isGit);
                
                if (isGit) {
                    console.log('Testing git log command...');
                    const commits = await gitService.getCommits({ maxCommits: 5 });
                    console.log('Test commits loaded:', commits.length);
                    console.log('Sample commit:', commits[0]);
                    
                    vscode.window.showInformationMessage(`Found ${commits.length} commits in test`);
                    
                    // Test branches
                    console.log('Testing branches...');
                    const branches = await gitService.getBranches();
                    console.log('Branches loaded:', branches.length);
                    
                    // Test authors
                    console.log('Testing authors...');
                    const authors = await gitService.getAuthors();
                    console.log('Authors loaded:', authors.length);
                    
                } else {
                    vscode.window.showInformationMessage('Not a git repository');
                }
            } catch (error) {
                console.error('Git test failed:', error);
                console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
                vscode.window.showErrorMessage(`Git test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        } else {
            vscode.window.showErrorMessage('No workspace folder found');
        }
    });

    const openCommand = vscode.commands.registerCommand('git-viz.open', () => {
        console.log('git-viz.open command triggered');
        vscode.window.showInformationMessage('Opening Git Visualization...');
        openGitVisualization(context);
    });

    const refreshCommand = vscode.commands.registerCommand('git-viz.refresh', () => {
        console.log('git-viz.refresh command triggered');
        refreshGitVisualization();
    });

    const zoomInCommand = vscode.commands.registerCommand('git-viz.zoomIn', () => {
        console.log('git-viz.zoomIn command triggered');
        zoomIn();
    });

    const zoomOutCommand = vscode.commands.registerCommand('git-viz.zoomOut', () => {
        console.log('git-viz.zoomOut command triggered');
        zoomOut();
    });

    // Add all subscriptions
    context.subscriptions.push(
        testCommand,
        openCommand,
        refreshCommand,
        zoomInCommand,
        zoomOutCommand
    );
    
    console.log('All subscriptions added to context');
}

let currentPanel: vscode.WebviewPanel | undefined;
let currentGitService: GitService | undefined;
let currentFilters: GitFilters = {
    maxCommits: 20,
    maxBranches: 5
};

function openGitVisualization(context: vscode.ExtensionContext) {
    console.log('openGitVisualization called');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    console.log('Workspace root:', workspaceRoot);
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    console.log('Creating GitService...');
    currentGitService = new GitService(workspaceRoot);

    console.log('Creating webview panel...');
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

    console.log('Setting webview HTML...');
    currentPanel.webview.html = getWebviewContent(context, currentPanel);

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
                case 'getFileChanges':
                    if (currentGitService && currentPanel) {
                        try {
                            const changes = await currentGitService.getFileChanges(message.hash);
                            currentPanel.webview.postMessage({
                                command: 'fileChangesResponse',
                                hash: message.hash,
                                changes: changes
                            });
                        } catch (error) {
                            console.error('Error getting file changes:', error);
                            currentPanel.webview.postMessage({
                                command: 'fileChangesResponse',
                                hash: message.hash,
                                changes: []
                            });
                        }
                    }
                    break;
            }
        },
        undefined,
        context.subscriptions
    );

    loadGitData();
}

async function loadGitData() {
    console.log('loadGitData called');
    if (!currentPanel || !currentGitService) {
        console.log('Missing currentPanel or currentGitService:', { currentPanel: !!currentPanel, currentGitService: !!currentGitService });
        return;
    }

    console.log('Starting git data loading...');
    const loadTimeout = setTimeout(() => {
        console.error('loadGitData timed out after 30 seconds');
        if (currentPanel) {
            currentPanel.webview.postMessage({
                command: 'updateStatus',
                status: 'Error: Git data loading timed out after 30 seconds'
            });
        }
    }, 30000);

    try {
        console.log('Checking if git repository...');
        const isGitRepo = await currentGitService.isGitRepository();
        console.log('Is git repository:', isGitRepo);
        if (!isGitRepo) {
            console.log('Not a git repository, sending status update');
            currentPanel.webview.postMessage({
                command: 'updateStatus',
                status: 'Not a git repository - please open a git repository folder'
            });
            return;
        }

        console.log('Sending loading status...');
        currentPanel.webview.postMessage({
            command: 'updateStatus',
            status: 'Loading git data...'
        });

        console.log('Loading commits...');
        let commits: GitCommit[] = [];
        try {
            commits = await currentGitService.getCommits(currentFilters);
            console.log('Loaded commits:', commits.length);
        } catch (error) {
            console.error('Failed to load commits:', error);
            console.error('Commit loading error details:', error instanceof Error ? error.message : 'Unknown error');
            currentPanel.webview.postMessage({
                command: 'updateStatus',
                status: `Error loading commits: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
            return; // Exit early if commits fail to load
        }
        
        console.log('Loading branches...');
        let branches: GitBranch[] = [];
        try {
            branches = await currentGitService.getBranches();
            console.log('Loaded branches:', branches.length);
        } catch (error) {
            console.error('Failed to load branches:', error);
            console.error('Branch loading error details:', error instanceof Error ? error.message : 'Unknown error');
            // Continue even if branches fail
        }
        
        console.log('Loading authors...');
        let authors: string[] = [];
        try {
            authors = await currentGitService.getAuthors();
            console.log('Loaded authors:', authors.length);
        } catch (error) {
            console.error('Failed to load authors:', error);
            console.error('Author loading error details:', error instanceof Error ? error.message : 'Unknown error');
            // Continue even if authors fail
        }

        console.log('Clearing timeout and sending git data...');
        clearTimeout(loadTimeout);
        
        // Check if we have any data to show
        if (commits.length === 0 && branches.length === 0) {
            console.log('No git data found, showing empty state');
            currentPanel.webview.postMessage({
                command: 'updateStatus',
                status: 'No commits found in this repository'
            });
            return;
        }
        
        currentPanel.webview.postMessage({
            command: 'updateGitData',
            commits,
            branches,
            authors,
            filters: currentFilters,
            status: `Showing ${commits.length} commits • ${branches.length} branches`
        });
        
        console.log('Git data sent successfully');

    } catch (error) {
        clearTimeout(loadTimeout);
        console.error('Error during git data loading:', error);
        console.error('Error details:', error instanceof Error ? error.message : 'Unknown error');
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        if (currentPanel) {
            currentPanel.webview.postMessage({
                command: 'updateStatus',
                status: `Error: ${(error instanceof Error ? error.message : 'Unknown error')}`
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

function getWebviewContent(context: vscode.ExtensionContext, panel: vscode.WebviewPanel) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git Visualization</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
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
        
        .graph-container {
            flex: 1;
            overflow: hidden;
            position: relative;
            cursor: grab;
        }
        
        .graph-container:active {
            cursor: grabbing;
        }
        
        .loading {
            text-align: center;
            padding: 50px;
            font-size: 18px;
            color: var(--vscode-descriptionForeground);
        }
        
        .error {
            color: var(--vscode-errorForeground);
            text-align: center;
            padding: 50px;
        }
        
        .git-graph {
            background: #1e1e1e;
            padding: 20px;
            border-radius: 8px;
            color: white;
            font-family: 'Segoe UI', sans-serif;
            width: 100%;
            height: 100%;
        }
        
        .git-svg {
            width: 100%;
            height: 100%;
            background: #1e1e1e;
        }
        
        .commit-node {
            cursor: pointer;
        }
        
        .commit-node:hover {
            stroke-width: 3;
        }
        
        .commit-text {
            fill: #ffffff;
            font-size: 12px;
            font-family: 'Segoe UI', sans-serif;
        }
        
        .branch-label {
            fill: #ffffff;
            font-size: 10px;
            font-weight: bold;
        }
        
        .author-text {
            fill: #cccccc;
            font-size: 10px;
            cursor: pointer;
        }
        
        .author-text:hover {
            fill: #ffffff;
            text-decoration: underline;
        }
        
        .commit-text {
            fill: #ffffff;
            font-size: 12px;
            font-family: 'Segoe UI', sans-serif;
            cursor: pointer;
        }
        
        .commit-text:hover {
            fill: #ffff00;
            text-decoration: underline;
        }
        
        .popup {
            position: fixed;
            background: var(--vscode-panel-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 16px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            max-width: 500px;
            max-height: 400px;
            overflow-y: auto;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
        }
        
        .popup-header {
            font-weight: bold;
            margin-bottom: 8px;
            color: var(--vscode-textPreformat-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 8px;
        }
        
        .popup-content {
            line-height: 1.4;
            white-space: pre-wrap;
            margin-bottom: 12px;
        }
        
        .file-changes {
            margin-top: 12px;
        }
        
        .file-changes-title {
            font-weight: bold;
            margin-bottom: 8px;
            color: var(--vscode-textPreformat-foreground);
        }
        
        .file-change {
            display: flex;
            align-items: center;
            margin: 4px 0;
            font-size: 12px;
        }
        
        .file-icon {
            width: 16px;
            height: 16px;
            margin-right: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
        }
        
        .file-added { color: #4caf50; }
        .file-modified { color: #ff9800; }
        .file-removed { color: #f44336; }
        .file-renamed { color: #2196f3; }
        
        .tags-section {
            margin-top: 12px;
        }
        
        .tags-title {
            font-weight: bold;
            margin-bottom: 8px;
            color: var(--vscode-textPreformat-foreground);
        }
        
        .tag-item {
            display: inline-block;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 11px;
            margin: 2px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="toolbar">
            <div class="status" id="status">Loading git data...</div>
            <div class="controls">
                <button class="btn" onclick="refreshData()">Refresh</button>
                <button class="btn" onclick="zoomIn()">+</button>
                <button class="btn" onclick="zoomOut()">-</button>
            </div>
        </div>
        
        <div class="graph-container" id="graph-container">
            <div class="loading" id="loading">Loading Git Visualization...</div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        let gitData = null;
        
        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            console.log('Webview received message:', message);
            switch (message.command) {
                case 'updateStatus':
                    console.log('Webview: Updating status to:', message.status);
                    document.getElementById('status').textContent = message.status;
                    break;
                case 'updateGitData':
                    console.log('Webview: Received git data:', message);
                    gitData = message;
                    document.getElementById('status').textContent = message.status || 'Ready';
                    console.log('Webview: Calling renderGitGraph...');
                    renderGitGraph();
                    break;
                case 'getFileChanges':
                    // Handle file changes request
                    vscode.postMessage({
                        command: 'getFileChanges',
                        hash: message.hash
                    });
                    break;
                case 'fileChangesResponse':
                    // Handle file changes response
                    if (window.pendingFileChangesRequests) {
                        const resolver = window.pendingFileChangesRequests[message.hash];
                        if (resolver) {
                            resolver(message.changes);
                            delete window.pendingFileChangesRequests[message.hash];
                        }
                    }
                    break;
            }
        });
        
        function showAuthorPopup(author, event) {
            const popup = document.createElement('div');
            popup.className = 'popup';
            popup.innerHTML = 
                '<div class="popup-header">Author Details</div>' +
                '<div class="popup-content">' + author + '</div>';
            
            document.body.appendChild(popup);
            
            // Position popup near mouse
            const rect = document.body.getBoundingClientRect();
            popup.style.left = (event.clientX + 10) + 'px';
            popup.style.top = (event.clientY + 10) + 'px';
            
            // Remove popup when clicking elsewhere
            setTimeout(() => {
                document.addEventListener('click', function removePopup() {
                    document.body.removeChild(popup);
                    document.removeEventListener('click', removePopup);
                });
            }, 100);
        }
        
        async function showCommitPopup(commit, event) {
            const popup = document.createElement('div');
            popup.className = 'popup';
            
            // Initialize pending requests object if it doesn't exist
            if (!window.pendingFileChangesRequests) {
                window.pendingFileChangesRequests = {};
            }
            
            // Get file changes
            let fileChangesHtml = '';
            try {
                // Send request for file changes
                vscode.postMessage({
                    command: 'getFileChanges',
                    hash: commit.hash
                });
                
                // Wait for response
                const changes = await new Promise((resolve) => {
                    window.pendingFileChangesRequests[commit.hash] = resolve;
                });
                
                if (changes && changes.length > 0) {
                    fileChangesHtml = '<div class="file-changes"><div class="file-changes-title">File Changes:</div>';
                    changes.forEach(change => {
                        let icon = '📄';
                        let className = 'file-modified';
                        
                        if (change.status === 'A') {
                            icon = '➕';
                            className = 'file-added';
                        } else if (change.status === 'M') {
                            icon = '✏️';
                            className = 'file-modified';
                        } else if (change.status === 'D') {
                            icon = '❌';
                            className = 'file-removed';
                        } else if (change.status.startsWith('R')) {
                            icon = '🔄';
                            className = 'file-renamed';
                        }
                        
                        fileChangesHtml += 
                            '<div class="file-change">' +
                                '<div class="file-icon ' + className + '">' + icon + '</div>' +
                                '<div>' + change.file + '</div>' +
                            '</div>';
                    });
                    fileChangesHtml += '</div>';
                }
            } catch (error) {
                console.error('Error getting file changes:', error);
            }
            
            // Get tags for this commit
            let tagsHtml = '';
            const tags = commit.refs.filter(ref => ref.startsWith('Tag '));
            if (tags.length > 0) {
                tagsHtml = '<div class="tags-section"><div class="tags-title">Tags:</div>';
                tags.forEach(tag => {
                    const tagName = tag.replace('Tag ', '');
                    tagsHtml += '<span class="tag-item">' + tagName + '</span>';
                });
                tagsHtml += '</div>';
            }
            
            popup.innerHTML = 
                '<div class="popup-header">Commit Details</div>' +
                '<div class="popup-content">' + commit.message + '</div>' +
                fileChangesHtml +
                tagsHtml;
            
            document.body.appendChild(popup);
            
            // Position popup near mouse
            const rect = document.body.getBoundingClientRect();
            popup.style.left = (event.clientX + 10) + 'px';
            popup.style.top = (event.clientY + 10) + 'px';
            
            // Remove popup when clicking elsewhere
            setTimeout(() => {
                document.addEventListener('click', function removePopup() {
                    document.body.removeChild(popup);
                    document.removeEventListener('click', removePopup);
                });
            }, 100);
        }
        
        function renderGitGraph() {
            console.log('renderGitGraph called with gitData:', gitData);
            const container = document.getElementById('graph-container');
            const loading = document.getElementById('loading');
            
            if (!gitData || !gitData.commits || gitData.commits.length === 0) {
                console.log('No git data or commits found');
                loading.innerHTML = '<div class="error">No commits found</div>';
                return;
            }
            
            console.log('Rendering git graph with', gitData.commits.length, 'commits');
            loading.style.display = 'none';
            
            // Clear previous content
            container.innerHTML = '';
            
            // Create SVG for git graph
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.className = 'git-svg';
            svg.setAttribute('viewBox', '0 0 2000 800');
            svg.style.width = '100%';
            svg.style.height = '100%';
            
            // Define arrow marker (pointing right for chronological order)
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', 'arrowhead');
            marker.setAttribute('markerWidth', '10');
            marker.setAttribute('markerHeight', '7');
            marker.setAttribute('refX', '9');
            marker.setAttribute('refY', '3.5');
            marker.setAttribute('orient', 'auto');
            
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', '0 0, 10 3.5, 0 7');
            polygon.setAttribute('fill', 'currentColor');
            marker.appendChild(polygon);
            defs.appendChild(marker);
            svg.appendChild(defs);
            
            // Process commits and create proper branch lanes
            const commits = gitData.commits.slice(0, 50).reverse(); // Reverse to show oldest first
            const branchColors = ['#1A73E8', '#34A853', '#FBBC05', '#E91E63', '#00ACC1', '#8E24AA', '#F4511E', '#7CB342', '#795548', '#607D8B'];
            
            // Create branch detection and lane assignment
            const branchCommits = {};
            const branchLanes = {};
            const commitPositions = {};
            let nextLane = 0;
            
            // First pass: identify branches and assign lanes based on refs
            commits.forEach(commit => {
                const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
                const branchNames = branchRefs.map(ref => ref.replace('Branch ', ''));
                
                // Check for main branch indicators
                const isMainBranch = branchNames.includes('main') || 
                                   branchNames.includes('origin/main') || 
                                   commit.refs.some(ref => ref.includes('main'));
                
                // Check for specific branch indicators
                const isDevBranch = branchNames.includes('dev') || 
                                  branchNames.includes('origin/dev') ||
                                  commit.refs.some(ref => ref.includes('dev'));
                
                const isTestBranch = branchNames.includes('test') || 
                                   branchNames.includes('origin/test') ||
                                   commit.refs.some(ref => ref.includes('test'));
                
                let branchName = 'main'; // Default
                
                if (isTestBranch) {
                    branchName = 'test';
                } else if (isDevBranch) {
                    branchName = 'dev';
                } else if (isMainBranch || branchNames.length === 0) {
                    branchName = 'main';
                } else if (branchNames.length > 0) {
                    branchName = branchNames[0];
                }
                
                branchCommits[commit.hash] = branchName;
                
                if (!branchLanes[branchName]) {
                    branchLanes[branchName] = nextLane;
                    nextLane++;
                }
            });
            
            // Ensure main branch gets lane 0
            if (branchLanes['main'] !== 0) {
                const mainLane = branchLanes['main'];
                branchLanes['main'] = 0;
                // Adjust other lanes
                Object.keys(branchLanes).forEach(branch => {
                    if (branch !== 'main' && branchLanes[branch] < mainLane) {
                        branchLanes[branch]++;
                    }
                });
            }
            
            // Second pass: assign positions based on chronological order and branch continuity
            const maxLanes = Math.max(Object.keys(branchLanes).length, 1);
            const commitSpacing = 1800 / commits.length;
            const laneHeight = 600 / Math.max(maxLanes, 3);
            
            commits.forEach((commit, index) => {
                const branchName = branchCommits[commit.hash] || 'main';
                const lane = branchLanes[branchName];
                const x = 100 + index * commitSpacing;
                const y = 150 + lane * laneHeight;
                
                commitPositions[commit.hash] = { x, y, branchName, lane };
            });
            
            // Draw connections between commits - connect chronologically (older to newer)
            commits.forEach((commit, index) => {
                if (index === commits.length - 1) return; // Skip last commit
                
                const current = commitPositions[commit.hash];
                const next = commitPositions[commits[index + 1].hash];
                
                if (current && next) {
                    const color = branchColors[current.lane % branchColors.length];
                    
                    // Draw connection line from older to newer commit (left to right)
                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    line.setAttribute('d', 'M ' + current.x + ' ' + current.y + ' L ' + next.x + ' ' + next.y);
                    line.setAttribute('stroke', color);
                    line.setAttribute('stroke-width', '3');
                    line.setAttribute('fill', 'none');
                    line.setAttribute('opacity', '0.8');
                    line.setAttribute('marker-end', 'url(#arrowhead)');
                    svg.appendChild(line);
                }
            });
            
            // Draw commits
            commits.forEach((commit, index) => {
                const pos = commitPositions[commit.hash];
                if (!pos) return;
                
                const color = branchColors[pos.lane % branchColors.length];
                
                // Draw commit node
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', pos.x);
                circle.setAttribute('cy', pos.y);
                circle.setAttribute('r', '10');
                circle.setAttribute('fill', color);
                circle.setAttribute('stroke', 'white');
                circle.setAttribute('stroke-width', '2');
                circle.setAttribute('class', 'commit-node');
                circle.addEventListener('click', () => showCommitDetails(commit));
                svg.appendChild(circle);
                
                // Draw commit hash
                const hashText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                hashText.setAttribute('x', pos.x);
                hashText.setAttribute('y', pos.y - 30);
                hashText.setAttribute('class', 'commit-text');
                hashText.setAttribute('text-anchor', 'middle');
                hashText.textContent = commit.shortHash;
                svg.appendChild(hashText);
                
                // Draw author
                const authorText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                authorText.setAttribute('x', pos.x);
                authorText.setAttribute('y', pos.y + 30);
                authorText.setAttribute('class', 'author-text');
                authorText.setAttribute('text-anchor', 'middle');
                authorText.textContent = commit.author.length > 12 ? commit.author.substring(0, 12) + '...' : commit.author;
                authorText.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showAuthorPopup(commit.author, e);
                });
                svg.appendChild(authorText);

                // Draw commit message
                const messageText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                messageText.setAttribute('x', pos.x);
                messageText.setAttribute('y', pos.y + 45);
                messageText.setAttribute('class', 'commit-text');
                messageText.setAttribute('text-anchor', 'middle');
                messageText.textContent = commit.message.length > 15 ? commit.message.substring(0, 15) + '...' : commit.message;
                messageText.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showCommitPopup(commit, e);
                });
                svg.appendChild(messageText);
                
                // Draw branch labels only (no tags)
                commit.refs.forEach((ref, idx) => {
                    const labelY = pos.y - 50 - (idx * 15);
                    if (ref.startsWith('Branch ')) {
                        const branchName = ref.replace('Branch ', '');
                        const branchLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                        branchLabel.setAttribute('x', pos.x);
                        branchLabel.setAttribute('y', labelY);
                        branchLabel.setAttribute('class', 'branch-label');
                        branchLabel.setAttribute('text-anchor', 'middle');
                        branchLabel.textContent = branchName;
                        svg.appendChild(branchLabel);
                    }
                    // Tags are now ignored - no else if for Tag
                });
            });
            
            // Add mouse interaction handlers
            let isDragging = false;
            let startX = 0;
            let startY = 0;
            let currentScale = 1;
            let currentTranslateX = 0;
            let currentTranslateY = 0;
            
            // Mouse wheel zoom
            svg.addEventListener('wheel', (e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? 0.9 : 1.1;
                currentScale = Math.max(0.3, Math.min(3, currentScale * delta));
                
                const rect = svg.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                
                // Zoom towards mouse position
                const scaleDiff = currentScale - (currentScale / delta);
                currentTranslateX -= mouseX * scaleDiff;
                currentTranslateY -= mouseY * scaleDiff;
                
                updateTransform();
            });
            
            // Mouse drag pan
            svg.addEventListener('mousedown', (e) => {
                isDragging = true;
                startX = e.clientX - currentTranslateX;
                startY = e.clientY - currentTranslateY;
                svg.style.cursor = 'grabbing';
            });
            
            svg.addEventListener('mousemove', (e) => {
                if (isDragging) {
                    currentTranslateX = e.clientX - startX;
                    currentTranslateY = e.clientY - startY;
                    updateTransform();
                }
            });
            
            svg.addEventListener('mouseup', () => {
                isDragging = false;
                svg.style.cursor = 'grab';
            });
            
            svg.addEventListener('mouseleave', () => {
                isDragging = false;
                svg.style.cursor = 'grab';
            });
            
            function updateTransform() {
                svg.style.transform = 'translate(' + currentTranslateX + 'px, ' + currentTranslateY + 'px) scale(' + currentScale + ')';
                svg.style.transformOrigin = '0 0';
            }
            
            container.appendChild(svg);
        }
        
        function showCommitDetails(commit) {
            vscode.postMessage({
                command: 'showCommitDetails',
                commit: commit
            });
        }
        
        function refreshData() {
            vscode.postMessage({ command: 'loadGitData' });
        }
        
        function zoomIn() {
            vscode.postMessage({ command: 'zoomIn' });
        }
        
        function zoomOut() {
            vscode.postMessage({ command: 'zoomOut' });
        }
        
        // Request initial data
        console.log('Webview: Requesting initial git data...');
        vscode.postMessage({ command: 'loadGitData' });
        
        // Fallback: if no data received in 15 seconds, show error
        setTimeout(() => {
            if (!gitData) {
                console.log('Webview: No git data received after 15 seconds, showing error');
                const loading = document.getElementById('loading');
                if (loading) {
                    loading.innerHTML = '<div class="error">Failed to load git data after 15 seconds. Please try refreshing or check the console for errors.</div>';
                }
            }
        }, 15000);
    </script>
</body>
</html>`;
}

export function deactivate() {}
