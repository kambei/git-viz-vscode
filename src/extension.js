const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context) {
    console.log('=== Git Viz Extension Activation Started ===');

    // Register the main command
    const openCommand = vscode.commands.registerCommand('git-viz.open', () => {
        console.log('git-viz.open command triggered');
        openGitVisualization(context);
    });

    context.subscriptions.push(openCommand);
    console.log('=== Git Viz Extension Activation Complete ===');
}

let currentPanel;
let currentGitService;

class GitService {
    constructor(workspaceRoot) {
        console.log('GitService constructor called');
        this.workspaceRoot = workspaceRoot;
        this.gitExtension = vscode.extensions.getExtension('vscode.git');
        console.log('GitService initialized');
    }

    async isGitRepository() {
        try {
            if (!this.gitExtension) {
                return false;
            }
            
            const gitApi = this.gitExtension.exports.getAPI(1);
            const workspaceUri = vscode.Uri.file(this.workspaceRoot);
            const repo = gitApi.getRepository(workspaceUri);
            
            return repo !== null;
        } catch (error) {
            console.error('Error checking git repository:', error);
            return false;
        }
    }

    getGitRepository() {
        if (!this.gitExtension) {
            return null;
        }
        
        const gitApi = this.gitExtension.exports.getAPI(1);
        const workspaceUri = vscode.Uri.file(this.workspaceRoot);
        const repo = gitApi.getRepository(workspaceUri);
        
        return repo;
    }

    async getCommits(filters = {}) {
        try {
            console.log('GitService: Getting commits');
            const repo = this.getGitRepository();
            if (!repo) {
                return [];
            }
            
            const maxCommits = filters.maxCommits || 50;
            const commits = await repo.log({ maxEntries: maxCommits });
            
            console.log('GitService: Got', commits.length, 'commits');
            
            // Get branch information for better branch assignment
            const branches = repo.state.refs;
            const branchMap = new Map();
            
            // Create a map of commit hash to branch name
            branches.forEach(branch => {
                if (branch.type === 0) { // Head (local branch)
                    branchMap.set(branch.commit, branch.name.replace('refs/heads/', ''));
                } else if (branch.type === 1) { // RemoteHead (remote branch)
                    let cleanName = branch.name.replace('refs/remotes/', '');
                    if (cleanName.startsWith('origin/')) {
                        cleanName = cleanName.replace('origin/', '');
                    }
                    branchMap.set(branch.commit, cleanName);
                }
            });
            
            console.log('GitService: Branch map created with', branchMap.size, 'entries');
            
            // Transform commits to our format with better branch assignment
            const transformedCommits = commits.map((commit, index) => {
                // Determine branch for this commit
                let branch = 'main';
                let branchLevel = 0;
                
                // First, check if this commit is the HEAD of any branch
                for (const [commitHash, branchName] of branchMap) {
                    if (commitHash === commit.hash) {
                        branch = branchName;
                        break;
                    }
                }
                
                // If not a HEAD commit, try to determine branch from context
                if (branch === 'main') {
                    // Look at recent commits to determine likely branch
                    const recentCommits = commits.slice(Math.max(0, index - 3), index + 3);
                    const branchContext = new Map();
                    
                    recentCommits.forEach(recentCommit => {
                        if (recentCommit.message) {
                            const message = recentCommit.message.toLowerCase();
                            
                            // Look for branch patterns in commit messages
                            if (message.includes('feature/')) {
                                const featureMatch = message.match(/feature\/([^\s]+)/i);
                                if (featureMatch) {
                                    const featureBranch = 'feature/' + featureMatch[1];
                                    branchContext.set(featureBranch, (branchContext.get(featureBranch) || 0) + 1);
                                }
                            }
                            if (message.includes('bugfix/')) {
                                const bugfixMatch = message.match(/bugfix\/([^\s]+)/i);
                                if (bugfixMatch) {
                                    const bugfixBranch = 'bugfix/' + bugfixMatch[1];
                                    branchContext.set(bugfixBranch, (branchContext.get(bugfixBranch) || 0) + 1);
                                }
                            }
                            if (message.includes('develop')) {
                                branchContext.set('develop', (branchContext.get('develop') || 0) + 1);
                            }
                            if (message.includes('hotfix')) {
                                branchContext.set('hotfix', (branchContext.get('hotfix') || 0) + 1);
                    }
                }
            });
            
                    // Use the most mentioned branch in recent context
                    if (branchContext.size > 0) {
                        let maxCount = 0;
                        let mostLikelyBranch = 'main';
                        for (const [branchName, count] of branchContext) {
                            if (count > maxCount) {
                                maxCount = count;
                                mostLikelyBranch = branchName;
                            }
                        }
                        branch = mostLikelyBranch;
                    }
                }
                
                // Assign branch level based on branch name structure
                if (branch === 'main' || branch === 'master') {
                    branchLevel = 0;
                } else if (branch === 'develop') {
                    branchLevel = 1;
                } else if (branch.includes('hotfix/')) {
                    branchLevel = 1;
                } else if (branch.includes('feature/') || branch.includes('bugfix/')) {
                    branchLevel = 2;
                } else {
                    branchLevel = 1;
                }
                
                return {
                    hash: commit.hash,
                    shortHash: commit.hash.substring(0, 7),
                    message: commit.message,
                    fullMessage: commit.message,
                    author: commit.authorName,
                    authorEmail: commit.authorEmail,
                    date: commit.authorDate,
                    parents: commit.parents || [],
                    branch: branch,
                    branchLevel: branchLevel,
                    isMerge: commit.parents && commit.parents.length > 1,
                    isCheckout: false,
                    fileChanges: []
                };
            });

            console.log('GitService: Transformed', transformedCommits.length, 'commits');
            return transformedCommits;
        } catch (error) {
            console.error('GitService: Error getting commits:', error);
            return [];
        }
    }

    async getBranches(filters = {}) {
        try {
            console.log('GitService: Getting branches');
            const repo = this.getGitRepository();
            if (!repo) {
            return [];
            }

            const branches = repo.state.refs;
            console.log('GitService: Got', branches.length, 'refs');

            // Process branches
            const processedBranches = branches.map(branch => {
                let cleanName = branch.name;
                let isRemote = false;

                // Clean branch names
                if (branch.name.startsWith('refs/heads/')) {
                    cleanName = branch.name.replace('refs/heads/', '');
                } else if (branch.name.startsWith('refs/remotes/')) {
                    cleanName = branch.name.replace('refs/remotes/', '');
                    isRemote = true;
                }

                return {
                    name: cleanName,
                    commit: branch.commit,
                    type: branch.type,
                    isRemote: isRemote
                };
            });

            console.log('GitService: Processed', processedBranches.length, 'branches');
            return processedBranches;
        } catch (error) {
            console.error('GitService: Error getting branches:', error);
            return [];
        }
    }
    
    async getFileChanges(commitHash) {
        try {
            console.log('GitService: Getting file changes for commit:', commitHash);
            const repo = this.getGitRepository();
            if (!repo) {
                console.log('GitService: No repository found');
                return [];
            }

            // Get the commit
            const commit = await repo.getCommit(commitHash);
            if (!commit) {
                console.log('GitService: Commit not found:', commitHash);
                return [];
            }

            console.log('GitService: Found commit:', commit.hash);
            console.log('GitService: Commit parents:', commit.parents);
            console.log('GitService: Commit message:', commit.message);

            let fileChanges = [];

            if (commit.parents && commit.parents.length > 0) {
                // Get diff between parent and this commit
                const parentCommit = commit.parents[0];
                console.log('GitService: Getting diff from parent:', parentCommit);
                
                try {
                    const diff = await repo.diff(parentCommit, commit.hash);
                    console.log('GitService: Got diff, length:', diff.length);
                    console.log('GitService: Diff content (first 500 chars):', diff.substring(0, 500));
                    
                    if (diff && diff.length > 0) {
                        // Parse diff to extract file changes
                        const lines = diff.split('\n');
                        let currentFile = null;
                        
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i];
                            
                            // Look for file headers
                            if (line.startsWith('diff --git')) {
                                // Extract file names from diff header
                                const match = line.match(/diff --git a\/(.+) b\/(.+)/);
                                if (match) {
                                    currentFile = {
                                        name: match[2], // Use the "b" file name (new file)
                                        type: 'modified',
                                        icon: '📝',
                                        linesAdded: 0,
                                        linesDeleted: 0
                                    };
                                }
                            } else if (line.startsWith('+++')) {
                                // Extract file name from +++ line
                                const fileName = line.replace('+++ b/', '').replace('+++ a/', '');
                                if (currentFile) {
                                    currentFile.name = fileName;
                                }
                            } else if (line.startsWith('---')) {
                                // Extract file name from --- line
                                const fileName = line.replace('--- a/', '').replace('--- b/', '');
                                if (currentFile && fileName !== '/dev/null') {
                                    currentFile.name = fileName;
                                }
                            } else if (line.startsWith('+') && !line.startsWith('+++')) {
                                // Added line
                                if (currentFile) {
                                    currentFile.linesAdded++;
                                }
                            } else if (line.startsWith('-') && !line.startsWith('---')) {
                                // Deleted line
                                if (currentFile) {
                                    currentFile.linesDeleted++;
                                }
                            } else if (line.startsWith('@@')) {
                                // Hunk header - commit the current file if we have one
                                if (currentFile && !fileChanges.find(f => f.name === currentFile.name)) {
                                    // Determine file type based on changes
                                    if (currentFile.linesAdded > 0 && currentFile.linesDeleted === 0) {
                                        currentFile.type = 'added';
                                        currentFile.icon = '➕';
                                    } else if (currentFile.linesAdded === 0 && currentFile.linesDeleted > 0) {
                                        currentFile.type = 'deleted';
                                        currentFile.icon = '❌';
                                    } else {
                                        currentFile.type = 'modified';
                                        currentFile.icon = '📝';
                                    }
                                    
                                    fileChanges.push({ ...currentFile });
                                    currentFile = null;
                                }
                            }
                        }
                        
                        // Add any remaining file
                        if (currentFile && !fileChanges.find(f => f.name === currentFile.name)) {
                            if (currentFile.linesAdded > 0 && currentFile.linesDeleted === 0) {
                                currentFile.type = 'added';
                                currentFile.icon = '➕';
                            } else if (currentFile.linesAdded === 0 && currentFile.linesDeleted > 0) {
                                currentFile.type = 'deleted';
                                currentFile.icon = '❌';
                            } else {
                                currentFile.type = 'modified';
                                currentFile.icon = '📝';
                            }
                            fileChanges.push(currentFile);
                        }
                    }
                } catch (diffError) {
                    console.error('GitService: Error getting diff:', diffError);
                }
            } else {
                // First commit - all files are added
                console.log('GitService: First commit, getting tree entries');
                try {
                    const tree = await repo.getTree(commit.tree);
                    if (tree && tree.children) {
                        fileChanges = tree.children.map(child => ({
                            name: child.path,
                            type: 'added',
                            icon: '➕',
                            linesAdded: 1,
                            linesDeleted: 0
                        }));
                    }
                } catch (treeError) {
                    console.error('GitService: Error getting tree:', treeError);
                }
            }

            console.log('GitService: Returning', fileChanges.length, 'file changes');
            return fileChanges;
        } catch (error) {
            console.error('GitService: Error getting file changes:', error);
            return [];
        }
    }
}

function openGitVisualization(context) {
    try {
    console.log('openGitVisualization called');
        
        // Check if we're in a workspace
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
            vscode.window.showErrorMessage('Please open a workspace folder first');
        return;
    }

        console.log('Workspace root:', workspaceRoot);
        
        // Create GitService
    currentGitService = new GitService(workspaceRoot);

        // Create webview panel
    currentPanel = vscode.window.createWebviewPanel(
        'gitViz',
        'Git Visualization',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
                localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
            }
        );
        
        // Set webview content
        currentPanel.webview.html = getWebviewContent(context);
        
        // Handle messages from webview
    currentPanel.webview.onDidReceiveMessage(
            async (message) => {
                console.log('Extension: Received message:', message.command);
            switch (message.command) {
                case 'loadGitData':
                    console.log('Extension: Loading git data...');
                    await loadGitData();
                    break;
                case 'fileChangesRequest':
                    console.log('Extension: Received fileChangesRequest for commit:', message.hash);
                    try {
                        const timeoutPromise = new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('File changes request timeout')), 5000)
                        );
                        const changesPromise = currentGitService.getFileChanges(message.hash);
                        const changes = await Promise.race([changesPromise, timeoutPromise]);
                        
                            currentPanel.webview.postMessage({
                                command: 'fileChangesResponse',
                                hash: message.hash,
                                changes: changes
                            });
                        console.log('Extension: Sent file changes response:', changes.length, 'changes');
                        } catch (error) {
                        console.error('Extension: Error getting file changes:', error);
                            currentPanel.webview.postMessage({
                                command: 'fileChangesResponse',
                                hash: message.hash,
                                changes: []
                            });
                    }
                    break;
            }
        },
        undefined,
        context.subscriptions
    );

        // Handle panel disposal
        currentPanel.onDidDispose(() => {
            currentPanel = null;
            currentGitService = null;
        }, null, context.subscriptions);
        
        console.log('Git Visualization opened successfully!');

        } catch (error) {
        console.error('Error opening Git Visualization:', error);
        vscode.window.showErrorMessage('Error opening Git Visualization: ' + error.message);
    }
}

function getWebviewContent(context) {
    // Get the path to the webview HTML file
    const webviewPath = path.join(context.extensionPath, 'src', 'webview.html');
    
    try {
        // Read the HTML file
        const htmlContent = fs.readFileSync(webviewPath, 'utf8');
        console.log('Webview HTML loaded from file:', webviewPath);
        return htmlContent;
        } catch (error) {
        console.error('Error loading webview HTML file:', error);
        // Fallback to a simple HTML
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git Visualization</title>
</head>
<body>
    <div style="padding: 20px; font-family: var(--vscode-font-family); color: var(--vscode-foreground);">
        <h2>Git Visualization</h2>
        <p>Webview loaded successfully!</p>
        <p>Status: <span id="status">Ready</span></p>
            </div>
    <script>
        const vscode = acquireVsCodeApi();
        console.log('Webview loaded successfully');
    </script>
</body>
</html>`;
    }
}

async function loadGitData() {
    if (!currentGitService || !currentPanel) {
        console.log('Extension: No GitService or panel available');
        return;
    }

    try {
        console.log('Extension: Loading Git data...');
        
        // Update status
        currentPanel.webview.postMessage({
            command: 'updateStatus',
            status: 'Loading Git data...'
        });

        // Check if it's a Git repository
        const isGit = await currentGitService.isGitRepository();
        if (!isGit) {
            currentPanel.webview.postMessage({
                command: 'updateStatus',
                status: 'Not a Git repository'
            });
                return;
            }
            
        // Get commits and branches
        const commits = await currentGitService.getCommits({ maxCommits: 50 });
        const branches = await currentGitService.getBranches();

        console.log('Extension: Got commits:', commits.length);
        console.log('Extension: Got branches:', branches.length);
        console.log('Extension: Branches data:', branches);

        // Process authors data
        const authorMap = new Map();
        commits.forEach(commit => {
            const authorName = commit.author;
            if (authorMap.has(authorName)) {
                authorMap.get(authorName).commitCount++;
                    } else {
                authorMap.set(authorName, {
                    name: authorName,
                    email: commit.authorEmail,
                    commitCount: 1
                });
            }
        });
        const authors = Array.from(authorMap.values());

        console.log('Extension: Got authors:', authors.length);

        // Send data to webview
        currentPanel.webview.postMessage({
            command: 'updateGitData',
            commits: commits,
            branches: branches,
            authors: authors,
            info: {
                totalCommits: commits.length,
                totalBranches: branches.length,
                totalAuthors: authors.length
            }
        });

        console.log('Extension: Git data sent to webview');

    } catch (error) {
        console.error('Extension: Error loading Git data:', error);
        if (currentPanel) {
            currentPanel.webview.postMessage({
                command: 'updateStatus',
                status: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        }
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};