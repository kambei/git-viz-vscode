const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

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
        this.execAsync = util.promisify(exec);
        console.log('GitService initialized');
    }

    async isGitRepository() {
        try {
            const { stdout } = await this.execAsync('git rev-parse --is-inside-work-tree', { cwd: this.workspaceRoot });
            return stdout.trim() === 'true';
        } catch (error) {
            console.error('Error checking git repository:', error);
            return false;
        }
    }

    async executeGitCommand(command, options = {}) {
        try {
            const { stdout, stderr } = await this.execAsync(command, { 
                cwd: this.workspaceRoot,
                ...options 
            });
            if (stderr && !stderr.includes('warning')) {
                console.warn('Git command stderr:', stderr);
            }
            return stdout;
        } catch (error) {
            console.error(`Error executing git command "${command}":`, error);
            throw error;
        }
    }

    async getCommits(filters = {}) {
        try {
            console.log('GitService: Getting commits');
            
            const maxCommits = filters.maxCommits || 50;
            
            // Get commits using git log with custom format including branch information
            const logFormat = '%H|%h|%s|%an|%ae|%ad|%P|%D';
            const logCommand = `git log --max-count=${maxCommits} --pretty=format:"${logFormat}" --date=iso-strict --all --decorate=full`;
            
            const logOutput = await this.executeGitCommand(logCommand);
            const commitLines = logOutput.trim().split('\n').filter(line => line.trim());
            
            console.log('GitService: Got', commitLines.length, 'commits');
            console.log('GitService: Sample log output:', commitLines.slice(0, 3));
            
            // Get branch information for better branch assignment
            const branchMap = await this.getBranchMap();
            console.log('GitService: Branch map created with', branchMap.size, 'entries');
            
            // Transform commits to our format
            const transformedCommits = commitLines.map((line, index) => {
                const [hash, shortHash, message, authorName, authorEmail, authorDate, parentsStr, refNames] = line.split('|');
                const parents = parentsStr ? parentsStr.split(' ').filter(p => p.trim()) : [];
                
                // Determine branch for this commit
                let branch = 'main';
                let branchLevel = 0;
                
                // First, check if this commit is the HEAD of any branch
                for (const [commitHash, branchName] of branchMap) {
                    if (commitHash === hash) {
                        branch = branchName;
                        break;
                    }
                }
                
                // If not a HEAD commit, try to determine branch from ref names or git log decoration
                if (branch === 'main' && refNames) {
                    // Parse ref names to find branch information
                    const refs = refNames.split(',').map(ref => ref.trim()).filter(ref => ref);
                    console.log('GitService: Commit', shortHash, 'ref names:', refs);
                    
                    // Look for branch references with priority order
                    let foundBranch = null;
                    
                    // First priority: local branch references
                    for (const ref of refs) {
                        if (ref.includes('refs/heads/')) {
                            const branchName = ref.replace('refs/heads/', '');
                            if (branchName !== 'HEAD') {
                                foundBranch = branchName;
                                break;
                            }
                        }
                    }
                    
                    // Second priority: remote branch references
                    if (!foundBranch) {
                        for (const ref of refs) {
                            if (ref.includes('origin/')) {
                                const branchName = ref.replace('origin/', '');
                                if (branchName !== 'HEAD') {
                                    foundBranch = branchName;
                                    break;
                                }
                            }
                        }
                    }
                    
                    // Third priority: direct branch names
                    if (!foundBranch) {
                        for (const ref of refs) {
                            if (!ref.includes('HEAD') && !ref.includes('tag:') && !ref.includes('refs/')) {
                                foundBranch = ref;
                                break;
                            }
                        }
                    }
                    
                    if (foundBranch) {
                        branch = foundBranch;
                        console.log('GitService: Assigned commit', shortHash, 'to branch', branch, 'from ref names');
                    }
                }
                
                // If still on main, try to determine branch from commit message patterns and context
                if (branch === 'main') {
                    const commitMessage = message.toLowerCase();
                    
                    // Look for branch patterns in commit messages
                    if (commitMessage.includes('feature/')) {
                        const featureMatch = commitMessage.match(/feature\/([^\s]+)/i);
                        if (featureMatch) {
                            branch = 'feature/' + featureMatch[1];
                        }
                    } else if (commitMessage.includes('bugfix/')) {
                        const bugfixMatch = commitMessage.match(/bugfix\/([^\s]+)/i);
                        if (bugfixMatch) {
                            branch = 'bugfix/' + bugfixMatch[1];
                        }
                    } else if (commitMessage.includes('develop') || commitMessage.includes('dev')) {
                        branch = 'dev';
                    } else if (commitMessage.includes('test') || 
                               (commitMessage.includes('draft') && !commitMessage.includes('working')) ||
                               (commitMessage.includes('workin') && !commitMessage.includes('version'))) {
                        // Only assign to test if the message clearly indicates test activity
                        // Avoid assigning generic messages like "first commit", "working version" to test
                        if (!commitMessage.includes('first commit') && 
                            !commitMessage.includes('working version') &&
                            !commitMessage.includes('initial') &&
                            !commitMessage.includes('setup')) {
                            branch = 'test';
                        }
                    } else if (commitMessage.includes('hotfix')) {
                        const hotfixMatch = commitMessage.match(/hotfix\/([^\s]+)/i);
                        if (hotfixMatch) {
                            branch = 'hotfix/' + hotfixMatch[1];
                        } else {
                            branch = 'hotfix';
                        }
                    }
                    
                }
                
                // Assign branch level based on branch name structure
                if (branch === 'main' || branch === 'master') {
                    branchLevel = 0;
                } else if (branch === 'develop' || branch === 'dev') {
                    branchLevel = 1;
                } else if (branch.includes('hotfix/')) {
                    branchLevel = 1;
                } else if (branch.includes('feature/') || branch.includes('bugfix/')) {
                    branchLevel = 2;
                } else {
                    branchLevel = 1;
                }
                
                return {
                    hash: hash,
                    shortHash: shortHash,
                    message: message,
                    fullMessage: message, // Add fullMessage field
                    author: authorName,
                    authorEmail: authorEmail,
                    date: new Date(authorDate).toISOString(), // Ensure proper ISO format
                    parents: parents,
                    branch: branch,
                    branchLevel: branchLevel,
                    isMerge: parents.length > 1,
                    isCheckout: this.isCheckoutCommit({ message }), // Add proper checkout detection
                    fileChanges: [] // Initialize empty fileChanges array
                };
            });

            console.log('GitService: Transformed', transformedCommits.length, 'commits');
            
            // Log branch distribution for debugging
            const branchDistribution = new Map();
            transformedCommits.forEach(commit => {
                const count = branchDistribution.get(commit.branch) || 0;
                branchDistribution.set(commit.branch, count + 1);
            });
            console.log('GitService: Branch distribution:', Array.from(branchDistribution.entries()));
            
            // Log sample commits with their branch assignments
            console.log('GitService: Sample commits with branches:');
            transformedCommits.slice(0, 5).forEach(commit => {
                console.log(`  ${commit.shortHash}: ${commit.message} -> ${commit.branch} (level ${commit.branchLevel})`);
            });
            
            // Apply filters
            let filteredCommits = transformedCommits;
            
            // Apply branch filter
            if (filters.branch) {
                filteredCommits = filteredCommits.filter(commit => commit.branch === filters.branch);
                console.log('GitService: Applied branch filter, commits:', filteredCommits.length);
            }
            
            // Apply author filter
            if (filters.author) {
                filteredCommits = filteredCommits.filter(commit => commit.author === filters.author);
                console.log('GitService: Applied author filter, commits:', filteredCommits.length);
            }
            
            // Apply showMerges filter
            if (filters.showMerges === false) {
                filteredCommits = filteredCommits.filter(commit => !commit.isMerge);
                console.log('GitService: Applied showMerges filter, commits:', filteredCommits.length);
            }
            
            console.log('GitService: Final filtered commits:', filteredCommits.length);
            return filteredCommits;
        } catch (error) {
            console.error('GitService: Error getting commits:', error);
            return [];
        }
    }

    async getBranchMap() {
        try {
            const branchMap = new Map();
            
            // Get local branches
            const localBranches = await this.executeGitCommand('git branch --format="%(refname:short)|%(objectname)"');
            localBranches.trim().split('\n').forEach(line => {
                if (line.trim()) {
                    const [name, commit] = line.split('|');
                    if (name && commit) {
                        branchMap.set(commit.trim(), name.trim());
                    }
                }
            });
            
            // Get remote branches
            const remoteBranches = await this.executeGitCommand('git branch -r --format="%(refname:short)|%(objectname)"');
            remoteBranches.trim().split('\n').forEach(line => {
                if (line.trim() && !line.includes('HEAD')) {
                    const [name, commit] = line.split('|');
                    if (name && commit) {
                        let cleanName = name.trim();
                        if (cleanName.startsWith('origin/')) {
                            cleanName = cleanName.replace('origin/', '');
                        }
                        branchMap.set(commit.trim(), cleanName);
                    }
                }
            });
            
            return branchMap;
        } catch (error) {
            console.error('GitService: Error getting branch map:', error);
            return new Map();
        }
    }

    async getBranches(filters = {}) {
        try {
            console.log('GitService: Getting branches');
            
            // First, try to fetch remote branches to ensure we have the latest data
            try {
                console.log('GitService: Fetching remote branches...');
                await this.executeGitCommand('git fetch --all');
                console.log('GitService: Remote fetch completed');
            } catch (fetchError) {
                console.log('GitService: Remote fetch failed, continuing with existing data:', fetchError.message);
            }
            
            const processedBranches = [];
            
            // Get local branches
            const localBranches = await this.executeGitCommand('git branch --format="%(refname:short)|%(objectname)|%(HEAD)"');
            localBranches.trim().split('\n').forEach(line => {
                if (line.trim()) {
                    const [name, commit, isCurrent] = line.split('|');
                    if (name && commit) {
                        processedBranches.push({
                            name: name.trim(),
                            commit: commit.trim(),
                            type: 0,
                            isRemote: false,
                            isCurrent: isCurrent && isCurrent.trim() === '*',
                            originalName: `refs/heads/${name.trim()}`
                        });
                        console.log('GitService: Added local branch:', name.trim(), 'current:', isCurrent && isCurrent.trim() === '*');
                    }
                }
            });
            
            // Get remote branches
            const remoteBranches = await this.executeGitCommand('git branch -r --format="%(refname:short)|%(objectname)"');
            remoteBranches.trim().split('\n').forEach(line => {
                if (line.trim() && !line.includes('HEAD')) {
                    const [name, commit] = line.split('|');
                    if (name && commit) {
                        let cleanName = name.trim();
                        if (cleanName.startsWith('origin/')) {
                            cleanName = cleanName.replace('origin/', '');
                        }
                        processedBranches.push({
                            name: cleanName,
                            commit: commit.trim(),
                            type: 1,
                            isRemote: true,
                            isCurrent: false,
                            originalName: name.trim()
                        });
                        console.log('GitService: Added remote branch:', cleanName, 'original:', name.trim());
                    }
                }
            });
            
            console.log('GitService: Processed', processedBranches.length, 'branches');
            console.log('GitService: Final branches:', processedBranches);
            
            return processedBranches;
        } catch (error) {
            console.error('GitService: Error getting branches:', error);
            return [];
        }
    }
    
    async getFileChanges(commitHash) {
        try {
            console.log('GitService: Getting file changes for commit:', commitHash);
            
            // Get commit info to check if it has parents
            const commitInfo = await this.executeGitCommand(`git show --format="%P" --no-patch ${commitHash}`);
            const parents = commitInfo.trim().split(' ').filter(p => p.trim());
            
            console.log('GitService: Commit parents:', parents);
            
            let fileChanges = [];
            
            if (parents.length > 0) {
                // Get diff between parent and this commit
                const parentCommit = parents[0];
                console.log('GitService: Getting diff from parent:', parentCommit);
                
                try {
                    // First get the diff stats for accurate line counts
                    const diffStats = await this.executeGitCommand(`git diff --numstat ${parentCommit} ${commitHash}`);
                    console.log('GitService: Got diff stats:', diffStats);
                    
                    // Parse diff stats to get line counts
                    const statsMap = new Map();
                    if (diffStats && diffStats.trim()) {
                        const statLines = diffStats.trim().split('\n');
                        statLines.forEach(line => {
                            const parts = line.split('\t');
                            if (parts.length >= 3) {
                                const fileName = parts[2];
                                const added = parts[0] === '-' ? 0 : parseInt(parts[0]) || 0;
                                const deleted = parts[1] === '-' ? 0 : parseInt(parts[1]) || 0;
                                statsMap.set(fileName, { added, deleted });
                            }
                        });
                    }
                    
                    // Now get the actual diff to determine file types
                    const diff = await this.executeGitCommand(`git diff ${parentCommit} ${commitHash}`);
                    console.log('GitService: Got diff, length:', diff.length);
                    
                    if (diff && diff.length > 0) {
                        console.log('GitService: Diff content (first 1000 chars):', diff.substring(0, 1000));
                        
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
                                    const oldFile = match[1];
                                    const newFile = match[2];
                                    
                                    // Determine file type based on diff header
                                    let fileType = 'modified';
                                    let icon = '📝';
                                    
                                    if (oldFile === '/dev/null') {
                                        fileType = 'added';
                                        icon = '➕';
                                    } else if (newFile === '/dev/null') {
                                        fileType = 'deleted';
                                        icon = '❌';
                                    }
                                    
                                    const fileName = newFile === '/dev/null' ? oldFile : newFile;
                                    const stats = statsMap.get(fileName) || { added: 0, deleted: 0 };
                                    
                                    // If we couldn't detect from diff header, try to detect from stats
                                    if (fileType === 'modified' && stats.added > 0 && stats.deleted === 0) {
                                        fileType = 'added';
                                        icon = '➕';
                                    } else if (fileType === 'modified' && stats.added === 0 && stats.deleted > 0) {
                                        fileType = 'deleted';
                                        icon = '❌';
                                    }
                                    
                                    currentFile = {
                                        name: fileName,
                                        type: fileType,
                                        icon: icon,
                                        linesAdded: stats.added,
                                        linesDeleted: stats.deleted
                                    };
                                    console.log('GitService: Found file in diff:', currentFile.name, 'type:', currentFile.type, 'icon:', currentFile.icon, 'lines:', currentFile.linesAdded, '+', currentFile.linesDeleted, '-');
                                }
                            } else if (line.startsWith('+++')) {
                                // Extract file name from +++ line
                                const fileName = line.replace('+++ b/', '').replace('+++ a/', '');
                                if (currentFile && fileName !== '/dev/null') {
                                    currentFile.name = fileName;
                                    // Update stats if we have them
                                    const stats = statsMap.get(fileName);
                                    if (stats) {
                                        currentFile.linesAdded = stats.added;
                                        currentFile.linesDeleted = stats.deleted;
                                    }
                                    console.log('GitService: Updated file name from +++:', fileName);
                                }
                            } else if (line.startsWith('---')) {
                                // Extract file name from --- line
                                const fileName = line.replace('--- a/', '').replace('--- b/', '');
                                if (currentFile && fileName !== '/dev/null') {
                                    currentFile.name = fileName;
                                    // Update stats if we have them
                                    const stats = statsMap.get(fileName);
                                    if (stats) {
                                        currentFile.linesAdded = stats.added;
                                        currentFile.linesDeleted = stats.deleted;
                                    }
                                    console.log('GitService: Updated file name from ---:', fileName);
                                }
                            } else if (line.startsWith('@@')) {
                                // Hunk header - commit the current file if we have one
                                if (currentFile && !fileChanges.find(f => f.name === currentFile.name)) {
                                    // Ensure we have at least 1 line for added/deleted files
                                    if (currentFile.type === 'added' && currentFile.linesAdded === 0) {
                                        currentFile.linesAdded = 1;
                                    } else if (currentFile.type === 'deleted' && currentFile.linesDeleted === 0) {
                                        currentFile.linesDeleted = 1;
                                    }
                                    
                                    fileChanges.push({ ...currentFile });
                                    console.log('GitService: Added file change:', currentFile.name, 'type:', currentFile.type, 'lines:', currentFile.linesAdded, '+', currentFile.linesDeleted, '-');
                                    currentFile = null;
                                }
                            }
                        }
                        
                        // Add any remaining file
                        if (currentFile && !fileChanges.find(f => f.name === currentFile.name)) {
                            // Ensure we have at least 1 line for added/deleted files
                            if (currentFile.type === 'added' && currentFile.linesAdded === 0) {
                                currentFile.linesAdded = 1;
                            } else if (currentFile.type === 'deleted' && currentFile.linesDeleted === 0) {
                                currentFile.linesDeleted = 1;
                            }
                            
                            fileChanges.push(currentFile);
                            console.log('GitService: Added final file change:', currentFile.name, 'type:', currentFile.type, 'lines:', currentFile.linesAdded, '+', currentFile.linesDeleted, '-');
                        }
                    } else {
                        console.log('GitService: Empty diff received');
                    }
                } catch (diffError) {
                    console.error('GitService: Error getting diff:', diffError);
                }
            } else {
                // First commit - all files are added
                console.log('GitService: First commit, getting tree entries');
                try {
                    const treeOutput = await this.executeGitCommand(`git ls-tree -r ${commitHash}`);
                    const treeLines = treeOutput.trim().split('\n').filter(line => line.trim());
                    
                    fileChanges = treeLines.map(line => {
                        const parts = line.split('\t');
                        const fileName = parts[1];
                        return {
                            name: fileName,
                            type: 'added',
                            icon: '➕',
                            linesAdded: 1,
                            linesDeleted: 0
                        };
                    });
                    console.log('GitService: First commit files:', fileChanges.map(f => f.name));
                } catch (treeError) {
                    console.error('GitService: Error getting tree:', treeError);
                }
            }

            console.log('GitService: Returning', fileChanges.length, 'file changes');
            console.log('GitService: File changes:', fileChanges);
            return fileChanges;
        } catch (error) {
            console.error('GitService: Error getting file changes:', error);
            return [];
        }
    }
    
    isCheckoutCommit(commit) {
        if (!commit.message) return false;
        
        const message = commit.message.toLowerCase();
        return message.includes('checkout') || 
               message.includes('switch') || 
               message.includes('merge request') || 
               message.includes('pull request') ||
               message.includes('branch to') ||
               message.includes('branch from') ||
               message.includes('merged pr') ||
               message.includes('merged mr') ||
               message.includes('rebase') ||
               message.includes('cherry-pick') ||
               message.includes('test') ||
               message.includes('draft') ||
               message.includes('workin');
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
                    console.log('Extension: Loading real git data...');
                    await loadGitData(message.filters);
                    break;
                case 'fileChangesRequest':
                    console.log('Extension: Received fileChangesRequest for commit:', message.hash);
                    try {
                        const timeoutPromise = new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('File changes request timeout')), 10000)
                        );
                        const changesPromise = currentGitService.getFileChanges(message.hash);
                        const changes = await Promise.race([changesPromise, timeoutPromise]);
                        
                        console.log('Extension: Got file changes:', changes.length, 'changes');
                        console.log('Extension: File changes details:', changes);
                        
                        currentPanel.webview.postMessage({
                            command: 'fileChangesResponse',
                            hash: message.hash,
                            changes: changes
                        });
                        console.log('Extension: Sent file changes response:', changes.length, 'changes');
            } catch (error) {
                        console.error('Extension: Error getting file changes:', error);
                        console.error('Extension: Error details:', error.message);
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

async function loadGitData(filters = {}) {
    if (!currentGitService || !currentPanel) {
        console.log('Extension: No GitService or panel available');
        return;
    }

    try {
        console.log('Extension: Loading Git data with filters:', filters);
        
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
            
        // Merge filters with defaults
        const effectiveFilters = {
            maxCommits: filters.maxCommits || 200,
            maxBranches: filters.maxBranches || 20,
            showMerges: filters.showMerges !== undefined ? filters.showMerges : true,
            branch: filters.branch || null,
            author: filters.author || null
        };
        
        console.log('Extension: Using effective filters:', effectiveFilters);
            
        // Get commits and branches
        const commits = await currentGitService.getCommits(effectiveFilters);
        const branches = await currentGitService.getBranches(effectiveFilters);

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

        // Send data to webview in the expected format
        const gitData = {
            commits: commits,
            branches: branches,
            authors: authors,
            filters: effectiveFilters,
            info: {
                totalCommits: commits.length,
                totalBranches: branches.length,
                totalAuthors: authors.length
            },
            status: `Showing ${commits.length} commits • ${branches.length} branches`
        };

        currentPanel.webview.postMessage({
            command: 'updateGitData',
            ...gitData
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