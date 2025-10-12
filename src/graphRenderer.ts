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

        // First pass: assign lanes to commits with branch refs
        for (let i = 0; i < this.commits.length; i++) {
            const commit = this.commits[i];
            const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
            
            if (branchRefs.length > 0) {
                const branchName = branchRefs[0].replace('Branch ', '');
                const level = branchLevels.get(branchName) || 0;
                this.laneAssignments.set(commit.hash, level);
                
                // For primary branch, propagate backwards to show continuity
                const branchHierarchy = this.createBranchHierarchy();
                const maxLevel = Math.max(...Array.from(branchHierarchy.values()));
                const isPrimaryBranch = branchHierarchy.get(branchName) === maxLevel;
                
                if (isPrimaryBranch) {
                    this.propagateMainBranchBackwards(commit.hash, level);
                } else {
                    // Propagate forwards through first parent (which is now to the right)
                    if (commit.parents.length > 0) {
                        this.propagateBranchForwards(commit.parents[0], level);
                    }
                }
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
                    this.laneAssignments.set(commit.hash, 0); // Default lane
                }
            }
        }

        // Third pass: handle merge commits better
        this.handleMergeCommits();
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
            
            // If this commit doesn't have a lane assigned yet, assign it to main
            if (!this.laneAssignments.has(olderCommit.hash)) {
                this.laneAssignments.set(olderCommit.hash, lane);
            } else {
                // If it already has a lane, check if it should be on main instead
                const currentLane = this.laneAssignments.get(olderCommit.hash);
                const branchHierarchy = this.createBranchHierarchy();
                
                // If this commit is not explicitly on a secondary branch, put it on primary
                const branchRefs = olderCommit.refs.filter(ref => ref.startsWith('Branch '));
                const maxLevel = Math.max(...Array.from(branchHierarchy.values()));
                const secondaryLevel = maxLevel - 1;
                
                const isOnSecondaryBranch = branchRefs.some(ref => {
                    const branchName = ref.replace('Branch ', '');
                    return branchHierarchy.get(branchName) === secondaryLevel; // Secondary level
                });
                
                if (!isOnSecondaryBranch && currentLane === secondaryLevel) {
                    // Move from secondary lane to primary lane
                    this.laneAssignments.set(olderCommit.hash, lane);
                }
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

        // Dynamic branch hierarchy detection
        const branchList = Array.from(allBranches);
        
        // Find primary and secondary branches
        const primaryBranch = this.findPrimaryBranch(branchList);
        const secondaryBranches = this.findSecondaryBranches(branchList, primaryBranch);
        
        // Count total levels needed
        const remainingBranches = branchList.filter(branch => 
            branch !== primaryBranch && !secondaryBranches.includes(branch)
        );
        const patternGroups = this.groupBranchesByPatterns(remainingBranches);
        const totalLevels = 2 + patternGroups.size + (remainingBranches.length - Array.from(patternGroups.values()).flat().length > 0 ? 1 : 0);
        
        // Assign levels with primary branch at the top (highest level number)
        if (primaryBranch) {
            hierarchy.set(primaryBranch, totalLevels - 1); // Primary at top
        }
        
        // Secondary branches one level down
        secondaryBranches.forEach(branch => {
            hierarchy.set(branch, totalLevels - 2);
        });

        // Pattern-based branches
        let level = totalLevels - 3;
        for (const [pattern, branches] of patternGroups) {
            branches.forEach(branch => {
                hierarchy.set(branch, level);
            });
            level--;
        }

        // Remaining branches at the bottom
        const unassignedBranches = branchList.filter(branch => !hierarchy.has(branch));
        unassignedBranches.forEach(branch => {
            hierarchy.set(branch, Math.max(0, level));
        });

        return hierarchy;
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
        
        // Level names are indexed by level number (0 = bottom, maxLevel = top)
        // Primary branch is at maxLevel (top)
        const primaryBranch = Array.from(branchHierarchy.entries())
            .find(([_, level]) => level === maxLevel)?.[0];
        levelNames[maxLevel] = primaryBranch ? `${primaryBranch.charAt(0).toUpperCase() + primaryBranch.slice(1)}` : 'Primary';
        
        // Secondary branches are at maxLevel - 1
        const secondaryBranches = Array.from(branchHierarchy.entries())
            .filter(([_, level]) => level === maxLevel - 1)
            .map(([name, _]) => name);
        levelNames[maxLevel - 1] = secondaryBranches.length > 0 ? 
            `${secondaryBranches[0].charAt(0).toUpperCase() + secondaryBranches[0].slice(1)}` : 'Secondary';
        
        // Pattern-based names for other levels
        for (let level = maxLevel - 2; level >= 0; level--) {
            const branchesAtLevel = Array.from(branchHierarchy.entries())
                .filter(([_, l]) => l === level)
                .map(([name, _]) => name);
            
            if (branchesAtLevel.length > 0) {
                // Try to determine pattern from branch names
                const pattern = this.detectPatternFromBranches(branchesAtLevel);
                levelNames[level] = pattern || `Level ${level}`;
            } else {
                levelNames[level] = `Level ${level}`;
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
                    // Since commits are now in reverse order, edges go from child (left) to parent (right)
                    this.edges.push({
                        from: node,      // Child (newer commit, on the left)
                        to: parentNode, // Parent (older commit, on the right)
                        color: i === 0 ? node.color : parentNode.color // First parent uses child color
                    });
                }
            }
        }
    }

    render(): string {
        const width = this.PADDING.left + this.PADDING.right + Math.max(1, this.commits.length) * this.COLUMN_GAP;
        const height = this.PADDING.top + this.PADDING.bottom + Math.max(1, this.getMaxLane() + 1) * this.ROW_GAP;
        
        let svg = `
            <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" class="git-graph">
                <defs>
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
                            font-size: 11px;
                            font-weight: bold;
                            cursor: pointer;
                        }
                        .branch-label:hover {
                            fill: var(--vscode-textLink-activeForeground);
                        }
                        .level-label {
                            fill: var(--vscode-descriptionForeground);
                            font-size: 10px;
                            font-weight: bold;
                            opacity: 0.8;
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
        const { from, to, color } = edge;
        const dx = Math.max(10, to.x - from.x);
        const cx1 = from.x + dx / 2;
        const cx2 = to.x - dx / 2;
        
        return `
            <path d="M ${from.x} ${from.y} C ${cx1} ${from.y}, ${cx2} ${to.y}, ${to.x} ${to.y}"
                  stroke="${color}" stroke-width="2" fill="none" opacity="0.8"/>
        `;
    }

    private renderNode(node: GraphNode): string {
        const { commit, x, y, color } = node;
        
        let svg = `
            <circle cx="${x}" cy="${y}" r="${this.NODE_RADIUS}" 
                    fill="${color}" stroke="white" stroke-width="2" 
                    class="commit-node" data-hash="${commit.hash}"/>
        `;

        // Render SHA and clickable author above the node
        const sha = commit.shortHash;
        const author = commit.author || 'Unknown';
        
        svg += `
            <text x="${x}" y="${y - this.NODE_RADIUS - 8}" class="commit-text">
                ${sha} · 
                <tspan class="clickable-author" data-hash="${commit.hash}" data-author="${author}" data-author-email="${commit.authorEmail}">
                    ${this.truncateText(author, 15)}
                </tspan>
            </text>
        `;

        // Render clickable commit message below the node
        const message = commit.message || '';
        svg += `
            <text x="${x}" y="${y + this.NODE_RADIUS + 15}" class="commit-message clickable-message" 
                  data-hash="${commit.hash}" data-message="${message}" data-full-message="${commit.fullMessage}">
                ${this.truncateText(message, 25)}
            </text>
        `;

        // Render ref badges above the top text
        if (commit.refs.length > 0) {
            let badgeY = y - this.NODE_RADIUS - 25;
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
        const labelX = this.PADDING.left - 10; // Moved closer to avoid cutoff
        const levelX = this.PADDING.left - 80; // Better positioning for level labels
        
        // Define dynamic level names based on actual branch hierarchy
        const levelNames = this.generateLevelNames(branchHierarchy);
        
        for (const [branchName, lane] of branchLanes) {
            const y = this.PADDING.top + lane * this.ROW_GAP;
            const level = branchHierarchy.get(branchName) || 0;
            const levelName = levelNames[level] || 'Other';
            
            // Add level indicator (only if it's not empty and not "Other")
            if (levelName && levelName !== 'Other') {
                svg += `
                    <text x="${levelX}" y="${y + 4}" class="level-label" text-anchor="end">
                        ${levelName}
                    </text>
                `;
            }
            
            // Add branch name
            svg += `
                <text x="${labelX}" y="${y + 4}" class="branch-label" text-anchor="end">
                    ${branchName}
                </text>
            `;
        }
        
        return svg;
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
