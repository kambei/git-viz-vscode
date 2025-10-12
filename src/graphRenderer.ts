import { GitCommit } from './gitService';

export interface GraphNode {
    commit: GitCommit;
    x: number;
    y: number;
    lane: number;
    color: string;
}

export interface GraphEdge {
    from: GraphNode;
    to: GraphNode;
    color: string;
    isMerge: boolean;
    parentIndex: number;
    isMergeToMain: boolean;
    mergeDirection: 'up' | 'down' | 'same';
}

export class HorizontalGraphRenderer {
    private commits: GitCommit[];
    private nodes: GraphNode[] = [];
    private edges: GraphEdge[] = [];
    private laneAssignments: Map<string, number> = new Map();
    private colors: string[] = [
        '#1A73E8', '#34A853', '#FBBC05', '#E91E63',
        '#00ACC1', '#8E24AA', '#F4511E', '#7CB342'
    ];

    // Layout constants
    private readonly COLUMN_GAP = 180;
    private readonly ROW_GAP = 80; // Increased for better branch level separation
    private readonly NODE_RADIUS = 7;
    private readonly PADDING = { top: 96, right: 120, bottom: 96, left: 120 };

    constructor(commits: GitCommit[]) {
        // Reverse commits to show newest first (left to right)
        this.commits = [...commits].reverse();
        this.assignLanes();
        this.createNodes();
        this.createEdges();
    }

    private assignLanes(): void {
        // Create hierarchical branch structure with main branches on different levels
        const branchLevels = new Map<string, number>();
        const branchHierarchy = this.createBranchHierarchy();

        // Assign levels to branches based on hierarchy
        let currentLevel = 0;
        for (const [branchName, level] of branchHierarchy) {
            branchLevels.set(branchName, level);
        }

        // First pass: assign lanes based on commit history and branch relationships
        const maxLevel = Math.max(...Array.from(branchHierarchy.values()));
        
        // Process commits in chronological order (oldest first)
        for (let i = this.commits.length - 1; i >= 0; i--) {
            const commit = this.commits[i];
            const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
            
            // Determine which branch this commit originally belonged to
            const originalBranch = this.determineOriginalBranch(commit, branchHierarchy);
            const level = branchLevels.get(originalBranch || 'main') || 0;
            const lane = level;
            
            // Only assign if not already assigned
            if (!this.laneAssignments.has(commit.hash)) {
                this.laneAssignments.set(commit.hash, lane);
            }
            
            // For main branch commits, propagate backwards to show continuity
            if (originalBranch && branchHierarchy.get(originalBranch) === 0) {
                this.propagateMainBranchBackwards(commit.hash, lane);
            }
        }

        // Second pass: assign lanes to remaining commits
        for (let i = 0; i < this.commits.length; i++) {
            const commit = this.commits[i];
            if (!this.laneAssignments.has(commit.hash)) {
                // Try to inherit from children
                const childLane = this.findChildLane(commit.hash);
                if (childLane !== null) {
                    this.laneAssignments.set(commit.hash, childLane);
                } else {
                    // Default to main branch lane (0) for commits without explicit branch refs
                    this.laneAssignments.set(commit.hash, 0);
                }
            }
        }

        // Third pass: handle merge commits better
        this.handleMergeCommits();
    }

    private determineOriginalBranch(commit: any, branchHierarchy: Map<string, number>): string | null {
        const branchRefs = commit.refs.filter((ref: string) => ref.startsWith('Branch '));
        const branchNames = branchRefs.map((ref: string) => ref.replace('Branch ', ''));
        
        // If no branch refs, this is likely a main branch commit
        if (branchNames.length === 0) {
            return this.findMainBranchName(branchHierarchy);
        }
        
        // Check if this commit is on multiple branches
        if (branchNames.length > 1) {
            // If commit is on multiple branches, determine which one it was originally created on
            // Commits are usually created on the branch they're first committed to
            
            // Check commit message for clues
            const message = commit.message.toLowerCase();
            if (message.includes('merge') || message.includes('pull request')) {
                // This is likely a merge commit, should be on main
                return this.findMainBranchName(branchHierarchy);
            }
            
            // Check if any of the branches is main
            const mainBranchName = this.findMainBranchName(branchHierarchy);
            if (branchNames.includes(mainBranchName)) {
                return mainBranchName;
            }
            
            // If not on main, it was likely created on the feature branch
            // Return the first non-main branch
            return branchNames.find((name: string) => branchHierarchy.get(name) !== 0) || branchNames[0];
        }
        
        // Single branch case
        const branchName = branchNames[0];
        
        // If this is a merge commit, it should be on main
        const message = commit.message.toLowerCase();
        if (message.includes('merge') || message.includes('pull request')) {
            return this.findMainBranchName(branchHierarchy);
        }
        
        return branchName;
    }

    private findMainBranchName(branchHierarchy: Map<string, number>): string {
        // Find the main branch name (level 0)
        for (const [branchName, level] of branchHierarchy) {
            if (level === 0) {
                return branchName;
            }
        }
        
        // Fallback to common main branch names
        const commonMainNames = ['main', 'master', 'develop', 'trunk'];
        for (const name of commonMainNames) {
            if (branchHierarchy.has(name)) {
                return name;
            }
        }
        
        // If no main branch found, return the first branch
        return Array.from(branchHierarchy.keys())[0] || 'main';
    }

    private propagateMainBranchBackwards(commitHash: string, lane: number): void {
        // Find the commit and propagate backwards to show main branch continuity
        const commitIndex = this.commits.findIndex(c => c.hash.startsWith(commitHash));
        if (commitIndex === -1) return;

        const commit = this.commits[commitIndex];
        
        // For main branch, we want to show it as a continuous line
        // Look backwards through the commit history to find where main should start
        for (let i = commitIndex + 1; i < this.commits.length; i++) {
            const olderCommit = this.commits[i];
            
            // Always assign older commits to main branch lane unless they're explicitly on other branches
            const branchRefs = olderCommit.refs.filter(ref => ref.startsWith('Branch '));
            const branchNames = branchRefs.map(ref => ref.replace('Branch ', ''));
            
            // Check if this commit is explicitly on a feature branch
            const branchHierarchy = this.createBranchHierarchy();
            const isOnFeatureBranch = branchNames.some(branchName => {
                const level = branchHierarchy.get(branchName);
                return level !== undefined && level > 0; // Feature branch (not main)
            });
            
            // If not on a feature branch, assign to main branch lane
            if (!isOnFeatureBranch) {
                this.laneAssignments.set(olderCommit.hash, lane);
            }
        }
    }

    private createBranchHierarchy(): Map<string, number> {
        const hierarchy = new Map<string, number>();
        const allBranches = new Set<string>();
        
        // Collect all branch names
        for (const commit of this.commits) {
            const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
            branchRefs.forEach(ref => {
                const branchName = ref.replace('Branch ', '');
                allBranches.add(branchName);
            });
        }

        const branchList = Array.from(allBranches);
        
        // Find the main branch (main, master, or develop)
        const mainBranch = this.findMainBranch(branchList);
        
        if (mainBranch) {
            // Main branch is always level 0
            hierarchy.set(mainBranch, 0);
            
            // Build hierarchy based on git relationships
            this.buildBranchHierarchyFromGit(mainBranch, branchList, hierarchy);
        } else {
            // Fallback: if no main branch found, use the branch with most commits as level 0
            const primaryBranch = this.findPrimaryBranch(branchList);
            if (primaryBranch) {
                hierarchy.set(primaryBranch, 0);
                this.buildBranchHierarchyFromGit(primaryBranch, branchList, hierarchy);
            }
        }
        
        // Assign remaining branches to level 0 if they don't have a level
        branchList.forEach(branch => {
            if (!hierarchy.has(branch)) {
                hierarchy.set(branch, 0);
            }
        });
        
        return hierarchy;
    }

    private findMainBranch(branches: string[]): string | null {
        // Look for common main branch names
        const mainBranchNames = ['main', 'master', 'develop', 'trunk'];
        
        for (const mainName of mainBranchNames) {
            if (branches.includes(mainName)) {
                return mainName;
            }
        }
        
        return null;
    }

    private buildBranchHierarchyFromGit(
        rootBranch: string, 
        allBranches: string[], 
        hierarchy: Map<string, number>
    ): void {
        const processedBranches = new Set<string>([rootBranch]);
        const branchesToProcess = [...allBranches.filter(b => b !== rootBranch)];
        
        // Special handling for common branch patterns
        const commonFeatureBranches = ['dev', 'develop', 'feature', 'staging'];
        
        // First, assign common feature branches to level 1
        for (const branch of branchesToProcess) {
            if (commonFeatureBranches.includes(branch.toLowerCase())) {
                hierarchy.set(branch, 1);
                processedBranches.add(branch);
            }
        }
        
        // Process remaining branches level by level
        let currentLevel = 1;
        let branchesAtCurrentLevel = branchesToProcess.filter(b => !processedBranches.has(b));
        
        while (branchesAtCurrentLevel.length > 0) {
            const branchesAtNextLevel: string[] = [];
            
            for (const branch of branchesAtCurrentLevel) {
                if (processedBranches.has(branch)) continue;
                
                // Check if this branch was created from a branch at the current level
                const parentBranch = this.findParentBranch(branch, Array.from(processedBranches));
                
                if (parentBranch) {
                    hierarchy.set(branch, currentLevel);
                    processedBranches.add(branch);
                } else {
                    // If we can't determine parent, try again in next iteration
                    branchesAtNextLevel.push(branch);
                }
            }
            
            // Move to next level
            currentLevel++;
            branchesAtCurrentLevel = branchesAtNextLevel;
            
            // Prevent infinite loops
            if (currentLevel > 10) break;
        }
        
        // Assign remaining branches to level 1
        branchesAtCurrentLevel.forEach(branch => {
            if (!processedBranches.has(branch)) {
                hierarchy.set(branch, 1);
            }
        });
    }

    private findParentBranch(branch: string, possibleParents: string[]): string | null {
        // Find the commit where this branch diverged from its parent
        const branchCommits = this.getCommitsForBranch(branch);
        
        for (const parentBranch of possibleParents) {
            const parentCommits = this.getCommitsForBranch(parentBranch);
            
            // Check if this branch shares commits with the parent branch
            // and if it diverged from the parent
            if (this.branchDivergedFromParent(branchCommits, parentCommits)) {
                return parentBranch;
            }
        }
        
        return null;
    }

    private getCommitsForBranch(branchName: string): GitCommit[] {
        return this.commits.filter(commit => 
            commit.refs.some(ref => ref === `Branch ${branchName}`)
        );
    }

    private branchDivergedFromParent(branchCommits: GitCommit[], parentCommits: GitCommit[]): boolean {
        // Check if the branch shares some commits with parent but has unique commits
        const branchHashes = new Set(branchCommits.map(c => c.hash));
        const parentHashes = new Set(parentCommits.map(c => c.hash));
        
        // Find shared commits
        const sharedCommits = branchCommits.filter(c => parentHashes.has(c.hash));
        
        // Find unique commits in branch
        const uniqueCommits = branchCommits.filter(c => !parentHashes.has(c.hash));
        
        // Branch diverged if it has both shared and unique commits
        return sharedCommits.length > 0 && uniqueCommits.length > 0;
    }

    private findPrimaryBranch(branches: string[]): string | null {
        // Find the branch with the most commits or longest history
        const branchCommitCounts = new Map<string, number>();
        
        for (const commit of this.commits) {
            const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
            for (const ref of branchRefs) {
                const branchName = ref.replace('Branch ', '');
                branchCommitCounts.set(branchName, (branchCommitCounts.get(branchName) || 0) + 1);
            }
        }

        // Find branch with most commits
        let maxCommits = 0;
        let primaryBranch: string | null = null;
        
        for (const [branch, count] of branchCommitCounts) {
            if (count > maxCommits) {
                maxCommits = count;
                primaryBranch = branch;
            }
        }

        return primaryBranch;
    }

    private findSecondaryBranches(branches: string[], primaryBranch: string | null): string[] {
        if (!primaryBranch) return [];

        const secondaryBranches: string[] = [];
        
        // Find branches that have commits that merge into the primary branch
        for (const branch of branches) {
            if (branch === primaryBranch) continue;
            
            // Check if this branch has commits that appear to merge into primary
            const hasMergeCommits = this.commits.some(commit => {
                const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
                const branchNames = branchRefs.map(ref => ref.replace('Branch ', ''));
                
                // If commit is on primary branch and has multiple parents, it might be a merge
                return branchNames.includes(primaryBranch) && 
                       commit.parents.length > 1 &&
                       this.isBranchInParents(commit, branch);
            });

            if (hasMergeCommits) {
                secondaryBranches.push(branch);
            }
        }

        return secondaryBranches;
    }

    private isBranchInParents(commit: any, branchName: string): boolean {
        // Check if any parent commit is on the specified branch
        for (const parentHash of commit.parents) {
            const parentCommit = this.commits.find(c => c.hash.startsWith(parentHash));
            if (parentCommit) {
                const parentBranchRefs = parentCommit.refs.filter(ref => ref.startsWith('Branch '));
                const parentBranchNames = parentBranchRefs.map(ref => ref.replace('Branch ', ''));
                if (parentBranchNames.includes(branchName)) {
                    return true;
                }
            }
        }
        return false;
    }

    private groupBranchesByPatterns(branches: string[]): Map<string, string[]> {
        const groups = new Map<string, string[]>();
        
        // Common branch patterns (case-insensitive)
        const patterns = [
            { name: 'Feature', prefixes: ['feature/', 'feat/', 'f/', 'feature-', 'feat-'] },
            { name: 'Release', prefixes: ['release/', 'rel/', 'release-', 'rel-'] },
            { name: 'Hotfix', prefixes: ['hotfix/', 'fix/', 'bugfix/', 'hotfix-', 'fix-', 'bugfix-'] },
            { name: 'Bugfix', prefixes: ['bug/', 'bugfix/', 'bug-', 'bugfix-'] },
            { name: 'Patch', prefixes: ['patch/', 'patch-'] }
        ];

        for (const pattern of patterns) {
            const matchingBranches = branches.filter(branch => 
                pattern.prefixes.some(prefix => 
                    branch.toLowerCase().startsWith(prefix.toLowerCase())
                )
            );
            
            if (matchingBranches.length > 0) {
                groups.set(pattern.name, matchingBranches);
            }
        }

        return groups;
    }

    private generateLevelNames(branchHierarchy: Map<string, number>): string[] {
        const levelNames: string[] = [];
        const maxLevel = Math.max(...Array.from(branchHierarchy.values()));
        
        // Create a mapping from lane to branch name based on actual lane assignments
        const laneToBranch = new Map<number, string>();
        
        // Find which branch is assigned to each lane by looking at commits
        for (const commit of this.commits) {
            const lane = this.laneAssignments.get(commit.hash);
            if (lane !== undefined) {
                const originalBranch = this.determineOriginalBranch(commit, branchHierarchy);
                if (originalBranch && !laneToBranch.has(lane)) {
                    laneToBranch.set(lane, originalBranch);
                }
            }
        }
        
        // Generate level names based on lanes
        for (let lane = 0; lane <= maxLevel; lane++) {
            const branchName = laneToBranch.get(lane);
            
            if (branchName) {
                levelNames[lane] = `${branchName} (L${lane})`;
            } else {
                levelNames[lane] = `Level ${lane}`;
            }
        }
        
        return levelNames;
    }

    private detectPatternFromBranches(branches: string[]): string | null {
        // Check for common patterns in branch names
        const patterns = [
            { name: 'Feature', prefixes: ['feature/', 'feat/', 'f/', 'feature-', 'feat-'] },
            { name: 'Release', prefixes: ['release/', 'rel/', 'release-', 'rel-'] },
            { name: 'Hotfix', prefixes: ['hotfix/', 'fix/', 'bugfix/', 'hotfix-', 'fix-', 'bugfix-'] },
            { name: 'Bugfix', prefixes: ['bug/', 'bugfix/', 'bug-', 'bugfix-'] },
            { name: 'Patch', prefixes: ['patch/', 'patch-'] }
        ];

        for (const pattern of patterns) {
            const matchingBranches = branches.filter(branch => 
                pattern.prefixes.some(prefix => 
                    branch.toLowerCase().startsWith(prefix.toLowerCase())
                )
            );
            
            if (matchingBranches.length === branches.length) {
                return pattern.name;
            }
        }

        return null;
    }

    private propagateBranchForwards(parentHash: string, lane: number): void {
        const parentIndex = this.commits.findIndex(c => c.hash.startsWith(parentHash));
        if (parentIndex !== -1 && !this.laneAssignments.has(this.commits[parentIndex].hash)) {
            this.laneAssignments.set(this.commits[parentIndex].hash, lane);
            
            // Continue propagating if this commit has a first parent
            const parentCommit = this.commits[parentIndex];
            if (parentCommit.parents.length > 0) {
                this.propagateBranchForwards(parentCommit.parents[0], lane);
            }
        }
    }

    private findChildLane(commitHash: string): number | null {
        for (let i = 0; i < this.commits.length; i++) {
            const commit = this.commits[i];
            if (commit.parents.some(parent => parent.startsWith(commitHash))) {
                const lane = this.laneAssignments.get(commit.hash);
                if (lane !== undefined) {
                    return lane;
                }
            }
        }
        return null;
    }

    private handleMergeCommits(): void {
        // Handle merge commits by ensuring they connect properly to their parent branches
        for (let i = 0; i < this.commits.length; i++) {
            const commit = this.commits[i];
            
            // If this is a merge commit (has multiple parents)
            if (commit.parents.length > 1) {
                const currentLane = this.laneAssignments.get(commit.hash);
                if (currentLane !== undefined) {
                    // Find the first parent (usually the main branch)
                    const firstParentHash = commit.parents[0];
                    const firstParentIndex = this.commits.findIndex(c => c.hash.startsWith(firstParentHash));
                    
                    if (firstParentIndex !== -1) {
                        const firstParentCommit = this.commits[firstParentIndex];
                        const firstParentLane = this.laneAssignments.get(firstParentCommit.hash);
                        
                        // If the first parent doesn't have a lane assigned, assign it the same lane as the merge commit
                        if (firstParentLane === undefined) {
                            this.laneAssignments.set(firstParentCommit.hash, currentLane);
                        }
                    }
                }
            }
        }
    }

    private createNodes(): void {
        this.nodes = this.commits.map((commit, index) => {
            const lane = this.laneAssignments.get(commit.hash) || 0;
            const color = this.colors[lane % this.colors.length];
            
            return {
                commit,
                x: this.PADDING.left + index * this.COLUMN_GAP,
                y: this.PADDING.top + lane * this.ROW_GAP,
                lane,
                color
            };
        });
    }

    private createEdges(): void {
        this.edges = [];
        
        for (const node of this.nodes) {
            const commit = node.commit;
            
            for (let i = 0; i < commit.parents.length; i++) {
                const parentHash = commit.parents[i];
                const parentNode = this.nodes.find(n => n.commit.hash.startsWith(parentHash));
                
                if (parentNode) {
                    // Determine if this is a merge edge (multiple parents)
                    const isMerge = commit.parents.length > 1;
                    
                    // Determine if this is a merge to main branch
                    const isMergeToMain = this.isMergeToMainBranch(commit, parentNode, i, node);
                    
                    // Determine merge direction
                    const mergeDirection = this.getMergeDirection(node, parentNode);
                    
                    // Since commits are now in reverse order, edges go from child (left) to parent (right)
                    this.edges.push({
                        from: node,      // Child (newer commit, on the left)
                        to: parentNode, // Parent (older commit, on the right)
                        color: i === 0 ? node.color : parentNode.color, // First parent uses child color
                        isMerge: isMerge,
                        parentIndex: i,
                        isMergeToMain: isMergeToMain,
                        mergeDirection: mergeDirection
                    });
                }
            }
        }
    }

    private isMergeToMainBranch(commit: any, parentNode: GraphNode, parentIndex: number, currentNode: GraphNode): boolean {
        // Check if this is a merge commit (multiple parents)
        if (commit.parents.length <= 1) return false;
        
        // Check if the parent is on the main branch (level 0)
        const branchHierarchy = this.createBranchHierarchy();
        
        // Find branches at level 0 (main branch level)
        const mainBranches = Array.from(branchHierarchy.entries())
            .filter(([_, level]) => level === 0)
            .map(([name, _]) => name);
        
        // Check if parent commit is on a main branch
        const parentBranchRefs = parentNode.commit.refs.filter(ref => ref.startsWith('Branch '));
        const parentBranchNames = parentBranchRefs.map(ref => ref.replace('Branch ', ''));
        
        // Also check if the parent is at lane 0 (main branch lane)
        const isAtMainLane = parentNode.lane === 0;
        
        // Check if this is a merge commit that's merging into main
        const isMergeCommit = commit.message && commit.message.toLowerCase().includes('merge');
        
        // Check if current node is on a higher lane than parent (dev merging up to main)
        const isUpwardMerge = currentNode.lane > parentNode.lane;
        
        // Check if current node is on a feature branch (like dev) and parent is on main
        const currentNodeBranchRefs = currentNode.commit.refs.filter(ref => ref.startsWith('Branch '));
        const currentNodeBranchNames = currentNodeBranchRefs.map(ref => ref.replace('Branch ', ''));
        const isFeatureBranchToMain = currentNodeBranchNames.some(branchName => 
            !mainBranches.includes(branchName) && branchName !== 'HEAD'
        ) && (parentBranchNames.some(branchName => mainBranches.includes(branchName)) || isAtMainLane);
        
        return (parentBranchNames.some(branchName => mainBranches.includes(branchName)) || isAtMainLane) && 
               (isMergeCommit || isUpwardMerge || isFeatureBranchToMain);
    }

    private getMergeDirection(fromNode: GraphNode, toNode: GraphNode): 'up' | 'down' | 'same' {
        const dy = toNode.y - fromNode.y;
        const threshold = this.ROW_GAP * 0.3;
        
        if (dy > threshold) {
            return 'down'; // Merging down (from top to bottom)
        } else if (dy < -threshold) {
            return 'up';   // Merging up (from bottom to top)
        } else {
            return 'same'; // Same level merge
        }
    }

    render(): string {
        const width = this.PADDING.left + this.PADDING.right + Math.max(1, this.commits.length) * this.COLUMN_GAP;
        const height = this.PADDING.top + this.PADDING.bottom + Math.max(1, this.getMaxLane() + 1) * this.ROW_GAP;
        
        let svg = `
            <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" class="git-graph graph-svg">
                <defs>
                    <!-- Arrow markers for directional edges -->
                    <marker id="arrowhead" markerWidth="10" markerHeight="7" 
                            refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="var(--vscode-foreground)" opacity="0.8"/>
                    </marker>
                    <marker id="merge-arrowhead" markerWidth="10" markerHeight="7" 
                            refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="var(--vscode-textLink-foreground)" opacity="0.9"/>
                    </marker>
                    <style>
                        .git-graph {
                            background-color: var(--vscode-editor-background);
                            font-family: var(--vscode-font-family);
                            font-size: var(--vscode-font-size);
                        }
                        .commit-node {
                            cursor: pointer;
                            transition: r 0.2s ease;
                        }
                        .commit-node:hover {
                            r: ${this.NODE_RADIUS + 2};
                        }
                        .commit-text {
                            fill: var(--vscode-foreground);
                            font-size: 11px;
                            text-anchor: middle;
                        }
                        .clickable-author {
                            fill: var(--vscode-textLink-foreground);
                            cursor: pointer;
                            text-decoration: underline;
                        }
                        .clickable-author:hover {
                            fill: var(--vscode-textLink-activeForeground);
                        }
                        .commit-message {
                            fill: var(--vscode-foreground);
                            font-size: 10px;
                            text-anchor: middle;
                        }
                        .clickable-message {
                            fill: var(--vscode-textLink-foreground);
                            cursor: pointer;
                            text-decoration: underline;
                        }
                        .clickable-message:hover {
                            fill: var(--vscode-textLink-activeForeground);
                        }
                        .ref-badge {
                            fill: var(--vscode-button-background);
                            stroke: var(--vscode-button-border);
                            stroke-width: 1;
                        }
                        .branch-badge {
                            fill: var(--vscode-button-background);
                            stroke: var(--vscode-button-border);
                            stroke-width: 1;
                        }
                        .tag-badge {
                            fill: var(--vscode-button-secondaryBackground);
                            stroke: var(--vscode-button-secondaryBorder);
                            stroke-width: 1;
                        }
                        .ref-text {
                            fill: var(--vscode-button-foreground);
                            font-size: 9px;
                            text-anchor: middle;
                            font-weight: bold;
                        }
                        .branch-text {
                            fill: var(--vscode-button-foreground);
                            font-size: 9px;
                            text-anchor: middle;
                            font-weight: bold;
                        }
                        .tag-text {
                            fill: var(--vscode-button-secondaryForeground);
                            font-size: 9px;
                            text-anchor: middle;
                            font-weight: bold;
                        }
                        .branch-label {
                            fill: var(--vscode-textLink-foreground);
                            font-size: 12px;
                            font-weight: bold;
                            cursor: pointer;
                            text-shadow: 1px 1px 2px rgba(0,0,0,0.3);
                        }
                        .branch-label:hover {
                            fill: var(--vscode-textLink-activeForeground);
                        }
                        .level-label {
                            fill: var(--vscode-descriptionForeground);
                            font-size: 11px;
                            font-weight: bold;
                            opacity: 0.9;
                            text-shadow: 1px 1px 2px rgba(0,0,0,0.3);
                        }
                        .tag-label {
                            fill: var(--vscode-descriptionForeground);
                            font-size: 10px;
                            font-weight: bold;
                            cursor: pointer;
                        }
                        .tag-label:hover {
                            fill: var(--vscode-foreground);
                        }
                        .merge-to-main-edge {
                            stroke-dasharray: 10,5;
                            animation: merge-to-main-pulse 1.2s ease-in-out infinite;
                            filter: drop-shadow(0 0 4px currentColor);
                        }
                        .merge-downward-edge {
                            stroke-dasharray: 6,3;
                            animation: merge-pulse 2s ease-in-out infinite;
                        }
                        .merge-upward-edge {
                            stroke-dasharray: 4,6;
                            animation: merge-pulse 2s ease-in-out infinite;
                        }
                        .merge-same-level-edge {
                            stroke-dasharray: 5,5;
                            animation: merge-pulse 2s ease-in-out infinite;
                        }
                        .regular-edge {
                            transition: stroke-width 0.2s ease;
                        }
                        .regular-edge:hover {
                            stroke-width: 3;
                        }
                        @keyframes merge-to-main-pulse {
                            0%, 100% { opacity: 1.0; stroke-width: 3.5; }
                            50% { opacity: 0.8; stroke-width: 4.0; }
                        }
                        @keyframes merge-pulse {
                            0%, 100% { opacity: 0.9; }
                            50% { opacity: 0.6; }
                        }
                    </style>
                </defs>
        `;

        // Render edges first (so they appear behind nodes)
        for (const edge of this.edges) {
            svg += this.renderEdge(edge);
        }

        // Render nodes
        for (const node of this.nodes) {
            svg += this.renderNode(node);
        }

        // Render branch and tag labels
        svg += this.renderBranchLabels();
        svg += this.renderTagLabels();

        svg += '</svg>';
        return svg;
    }

    private renderEdge(edge: GraphEdge): string {
        const { from, to, color, isMerge, parentIndex, isMergeToMain, mergeDirection } = edge;
        const dx = Math.max(10, to.x - from.x);
        const dy = to.y - from.y;
        
        // Different curve styles for different edge types
        let pathData: string;
        let strokeWidth: number;
        let opacity: number;
        let markerEnd: string;
        let edgeClass: string;
        
        if (isMerge) {
            // Enhanced merge edge rendering based on direction and target
            if (isMergeToMain && mergeDirection === 'up') {
                // Bottom-up merge to main: special styling with pronounced upward curve
                const cx1 = from.x + dx * 0.15;
                const cy1 = from.y - dy * 0.4; // More pronounced upward curve
                const cx2 = to.x - dx * 0.15;
                const cy2 = to.y + dy * 0.2;
                
                pathData = `M ${from.x} ${from.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${to.x} ${to.y}`;
                strokeWidth = 3.5;
                opacity = 1.0;
                markerEnd = 'url(#merge-arrowhead)';
                edgeClass = 'merge-to-main-edge';
            } else if (isMergeToMain) {
                // Merge to main (even if not upward): force upward curve for visual clarity
                const cx1 = from.x + dx * 0.2;
                const cy1 = from.y - Math.max(dy * 0.3, this.ROW_GAP * 0.2); // Force minimum upward curve
                const cx2 = to.x - dx * 0.2;
                const cy2 = to.y + Math.max(dy * 0.1, this.ROW_GAP * 0.1);
                
                pathData = `M ${from.x} ${from.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${to.x} ${to.y}`;
                strokeWidth = 3.0;
                opacity = 1.0;
                markerEnd = 'url(#merge-arrowhead)';
                edgeClass = 'merge-to-main-edge';
            } else if (mergeDirection === 'up') {
                // Upward merge (bottom to top)
                const cx1 = from.x + dx * 0.3;
                const cy1 = from.y - dy * 0.2;
                const cx2 = to.x - dx * 0.3;
                const cy2 = to.y + dy * 0.1;
                
                pathData = `M ${from.x} ${from.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${to.x} ${to.y}`;
                strokeWidth = 2.5;
                opacity = 0.9;
                markerEnd = 'url(#merge-arrowhead)';
                edgeClass = 'merge-upward-edge';
            } else if (mergeDirection === 'down') {
                // Downward merge (top to bottom)
                const cx1 = from.x + dx * 0.3;
                const cy1 = from.y + dy * 0.2;
                const cx2 = to.x - dx * 0.3;
                const cy2 = to.y - dy * 0.1;
                
                pathData = `M ${from.x} ${from.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${to.x} ${to.y}`;
                strokeWidth = 2.5;
                opacity = 0.9;
                markerEnd = 'url(#merge-arrowhead)';
                edgeClass = 'merge-downward-edge';
            } else {
                // Same level merge
                const cx1 = from.x + dx / 2;
                const cx2 = to.x - dx / 2;
                
                pathData = `M ${from.x} ${from.y} C ${cx1} ${from.y}, ${cx2} ${to.y}, ${to.x} ${to.y}`;
                strokeWidth = 2.5;
                opacity = 0.9;
                markerEnd = 'url(#merge-arrowhead)';
                edgeClass = 'merge-same-level-edge';
            }
        } else {
            // Regular parent-child edges
            const cx1 = from.x + dx / 2;
            const cx2 = to.x - dx / 2;
            
            pathData = `M ${from.x} ${from.y} C ${cx1} ${from.y}, ${cx2} ${to.y}, ${to.x} ${to.y}`;
            strokeWidth = 2;
            opacity = 0.8;
            markerEnd = 'url(#arrowhead)';
            edgeClass = 'regular-edge';
        }
        
        return `
            <path d="${pathData}"
                  stroke="${color}" 
                  stroke-width="${strokeWidth}" 
                  fill="none" 
                  opacity="${opacity}"
                  marker-end="${markerEnd}"
                  class="${edgeClass}"/>
        `;
    }

    private renderNode(node: GraphNode): string {
        const { commit, x, y, color } = node;
        
        let svg = `
            <circle cx="${x}" cy="${y}" r="${this.NODE_RADIUS}" 
                    fill="${color}" stroke="white" stroke-width="2" 
                    class="commit-node" data-hash="${commit.hash}"/>
        `;

        // Calculate text positions with collision detection
        const textPositions = this.calculateTextPositions(node);
        
        // Render SHA and clickable author above the node
        const sha = commit.shortHash;
        const author = commit.author || 'Unknown';
        
        svg += `
            <text x="${x}" y="${textPositions.authorY}" class="commit-text">
                ${sha} · 
                <tspan class="clickable-author" data-hash="${commit.hash}" data-author="${author}" data-author-email="${commit.authorEmail}">
                    ${this.truncateText(author, 15)}
                </tspan>
            </text>
        `;

        // Render clickable commit message below the node
        const message = commit.message || '';
        svg += `
            <text x="${x}" y="${textPositions.messageY}" class="commit-message clickable-message" 
                  data-hash="${commit.hash}" data-message="${message}" data-full-message="${commit.fullMessage}">
                ${this.truncateText(message, 25)}
            </text>
        `;

        // Render ref badges above the top text
        if (commit.refs.length > 0) {
            let badgeY = textPositions.badgeY;
            for (const ref of commit.refs.slice(0, 3)) { // Limit to 3 badges
                svg += this.renderRefBadge(ref, x, badgeY);
                badgeY -= 20;
            }
        }

        return svg;
    }

    private renderRefBadge(ref: string, x: number, y: number): string {
        const isBranch = ref.startsWith('Branch ');
        const isTag = ref.startsWith('Tag ');
        let text = ref.replace(/^(Branch|Tag)\s+/, '');
        
        // Handle special cases for better display
        if (text === 'HEAD') {
            text = 'HEAD';
        }
        
        const width = Math.max(50, text.length * 6 + 20);
        const height = 18;
        
        // Different colors for branches and tags
        const badgeClass = isBranch ? 'branch-badge' : 'tag-badge';
        const textClass = isBranch ? 'branch-text' : 'tag-text';
        
        return `
            <rect x="${x - width/2}" y="${y - height/2}" width="${width}" height="${height}" 
                  rx="9" ry="9" class="ref-badge ${badgeClass}"/>
            <text x="${x}" y="${y + 4}" class="ref-text ${textClass}">${text}</text>
        `;
    }

    private calculateTextPositions(node: GraphNode): { authorY: number, messageY: number, badgeY: number } {
        const { x, y } = node;
        
        // Base positions
        let authorY = y - this.NODE_RADIUS - 8;
        let messageY = y + this.NODE_RADIUS + 15;
        let badgeY = y - this.NODE_RADIUS - 25;
        
        // Check for collisions with nearby nodes
        const nearbyNodes = this.nodes.filter(n => 
            n !== node && 
            Math.abs(n.x - x) < this.COLUMN_GAP * 0.8 && // Within 80% of column gap
            Math.abs(n.y - y) < this.ROW_GAP * 0.8      // Within 80% of row gap
        );
        
        // Check for collisions with branch labels on the same lane
        const branchLabelsY = this.PADDING.left - 10; // X position of branch labels
        const levelLabelsY = this.PADDING.left - 80; // X position of level labels
        
        // If this node is close to the left edge where branch labels are, adjust positions
        if (x - this.PADDING.left < 100) {
            const laneY = this.PADDING.top + node.lane * this.ROW_GAP;
            
            // Check if branch labels might overlap with our text
            if (Math.abs(y - laneY) < 30) {
                // Move text further away from branch labels
                authorY = Math.min(authorY, laneY - 30);
                badgeY = Math.min(badgeY, laneY - 50);
            }
        }
        
        for (const nearbyNode of nearbyNodes) {
            const nearbyAuthorY = nearbyNode.y - this.NODE_RADIUS - 8;
            const nearbyMessageY = nearbyNode.y + this.NODE_RADIUS + 15;
            const nearbyBadgeY = nearbyNode.y - this.NODE_RADIUS - 25;
            
            // Adjust author text position if it would overlap
            if (Math.abs(authorY - nearbyAuthorY) < 20) {
                if (authorY >= nearbyAuthorY) {
                    authorY = nearbyAuthorY - 20;
                } else {
                    authorY = nearbyAuthorY + 20;
                }
            }
            
            // Adjust message text position if it would overlap
            if (Math.abs(messageY - nearbyMessageY) < 20) {
                if (messageY >= nearbyMessageY) {
                    messageY = nearbyMessageY - 20;
                } else {
                    messageY = nearbyMessageY + 20;
                }
            }
            
            // Adjust badge position if it would overlap
            if (Math.abs(badgeY - nearbyBadgeY) < 20) {
                if (badgeY >= nearbyBadgeY) {
                    badgeY = nearbyBadgeY - 20;
                } else {
                    badgeY = nearbyBadgeY + 20;
                }
            }
        }
        
        return { authorY, messageY, badgeY };
    }

    private truncateText(text: string, maxLength: number): string {
        if (text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength - 3) + '...';
    }

    private getMaxLane(): number {
        return Math.max(...Array.from(this.laneAssignments.values()));
    }

    private renderBranchLabels(): string {
        const branchLanes = new Map<string, number>();
        const branchHierarchy = this.createBranchHierarchy();
        
        // Collect branch information from commits
        for (const commit of this.commits) {
            const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
            for (const ref of branchRefs) {
                const branchName = ref.replace('Branch ', '');
                const lane = this.laneAssignments.get(commit.hash);
                if (lane !== undefined && !branchLanes.has(branchName)) {
                    branchLanes.set(branchName, lane);
                }
            }
        }
        
        let svg = '';
        const labelX = this.PADDING.left - 10;
        const levelX = this.PADDING.left - 80;
        
        // Define dynamic level names based on actual branch hierarchy
        const levelNames = this.generateLevelNames(branchHierarchy);
        
        // Calculate positions for all labels to avoid overlaps
        const labelPositions = this.calculateLabelPositions(branchLanes, levelNames, branchHierarchy);
        
        for (const [branchName, lane] of branchLanes) {
            const level = branchHierarchy.get(branchName) || 0;
            const levelName = levelNames[level] || 'Other';
            const positions = labelPositions.get(branchName);
            
            if (positions) {
                // Add level indicator (only if it's not empty and not "Other")
                if (levelName && levelName !== 'Other') {
                    svg += `
                        <text x="${levelX}" y="${positions.levelY}" class="level-label" text-anchor="end">
                            ${levelName}
                        </text>
                    `;
                }
                
                // Add branch name
                svg += `
                    <text x="${labelX}" y="${positions.branchY}" class="branch-label" text-anchor="end">
                        ${branchName}
                    </text>
                `;
            }
        }
        
        return svg;
    }

    private calculateLabelPositions(
        branchLanes: Map<string, number>, 
        levelNames: string[], 
        branchHierarchy: Map<string, number>
    ): Map<string, { levelY: number, branchY: number }> {
        const positions = new Map<string, { levelY: number, branchY: number }>();
        const occupiedPositions = new Set<number>();
        const minSpacing = 20; // Minimum vertical spacing between labels
        
        // Sort branches by lane to process them in order
        const sortedBranches = Array.from(branchLanes.entries()).sort((a, b) => a[1] - b[1]);
        
        for (const [branchName, lane] of sortedBranches) {
            const baseY = this.PADDING.top + lane * this.ROW_GAP + 4;
            const level = branchHierarchy.get(branchName) || 0;
            const levelName = levelNames[level] || 'Other';
            
            // Calculate positions for level and branch labels
            let levelY = baseY;
            let branchY = baseY;
            
            // Check for conflicts with existing positions
            const conflicts = Array.from(occupiedPositions).filter(pos => 
                Math.abs(pos - baseY) < minSpacing
            );
            
            if (conflicts.length > 0) {
                // Find the best available position
                const sortedConflicts = conflicts.sort((a, b) => a - b);
                let bestY = baseY;
                
                // Try to place above existing labels
                for (let offset = minSpacing; offset <= minSpacing * 3; offset += minSpacing) {
                    const candidateY = baseY - offset;
                    if (!occupiedPositions.has(candidateY) && 
                        !Array.from(occupiedPositions).some(pos => Math.abs(pos - candidateY) < minSpacing)) {
                        bestY = candidateY;
                        break;
                    }
                }
                
                // If no space above, try below
                if (bestY === baseY) {
                    for (let offset = minSpacing; offset <= minSpacing * 3; offset += minSpacing) {
                        const candidateY = baseY + offset;
                        if (!occupiedPositions.has(candidateY) && 
                            !Array.from(occupiedPositions).some(pos => Math.abs(pos - candidateY) < minSpacing)) {
                            bestY = candidateY;
                            break;
                        }
                    }
                }
                
                levelY = branchY = bestY;
            }
            
            // Mark positions as occupied
            occupiedPositions.add(levelY);
            occupiedPositions.add(branchY);
            
            // Add small offset between level and branch labels if they're on the same line
            if (levelName && levelName !== 'Other') {
                branchY += 15; // Offset branch label slightly below level label
                occupiedPositions.add(branchY);
            }
            
            positions.set(branchName, { levelY, branchY });
        }
        
        return positions;
    }

    private renderTagLabels(): string {
        const tagLanes = new Map<string, number>();
        
        // Collect tag information from commits
        for (const commit of this.commits) {
            const tagRefs = commit.refs.filter(ref => ref.startsWith('Tag '));
            for (const ref of tagRefs) {
                const tagName = ref.replace('Tag ', '');
                const lane = this.laneAssignments.get(commit.hash);
                if (lane !== undefined && !tagLanes.has(tagName)) {
                    tagLanes.set(tagName, lane);
                }
            }
        }
        
        let svg = '';
        const labelX = this.getWidth() - this.PADDING.right + 20;
        
        for (const [tagName, lane] of tagLanes) {
            const y = this.PADDING.top + lane * this.ROW_GAP;
            svg += `
                <text x="${labelX}" y="${y + 4}" class="tag-label" text-anchor="start">
                    ${tagName}
                </text>
            `;
        }
        
        return svg;
    }

    getWidth(): number {
        return this.PADDING.left + this.PADDING.right + Math.max(1, this.commits.length) * this.COLUMN_GAP;
    }

    getHeight(): number {
        return this.PADDING.top + this.PADDING.bottom + Math.max(1, this.getMaxLane() + 1) * this.ROW_GAP;
    }

    getNodes(): GraphNode[] {
        return this.nodes;
    }

    getEdges(): GraphEdge[] {
        return this.edges;
    }
}
