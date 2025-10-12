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
    private readonly ROW_GAP = 52;
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
        // Assign lanes based on branch names from refs
        const branchLanes = new Map<string, number>();
        let nextLane = 0;

        // First pass: assign lanes to commits with branch refs
        // Prioritize main branches (main, master, develop) to get lower lane numbers
        const mainBranches = ['main', 'master', 'develop'];
        const branchPriority = new Map<string, number>();
        
        // Assign priority to main branches
        mainBranches.forEach((branch, index) => {
            branchPriority.set(branch, index);
        });

        // Collect all branch names and sort by priority
        const allBranches = new Set<string>();
        for (const commit of this.commits) {
            const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
            branchRefs.forEach(ref => {
                const branchName = ref.replace('Branch ', '');
                allBranches.add(branchName);
            });
        }

        // Sort branches by priority (main branches first, then alphabetically)
        const sortedBranches = Array.from(allBranches).sort((a, b) => {
            const priorityA = branchPriority.get(a) ?? 999;
            const priorityB = branchPriority.get(b) ?? 999;
            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }
            return a.localeCompare(b);
        });

        // Assign lanes to sorted branches
        sortedBranches.forEach(branchName => {
            branchLanes.set(branchName, nextLane++);
        });

        // Second pass: propagate branch assignments forwards through first-parent chains
        // Since commits are now in reverse chronological order, we propagate forwards
        for (let i = 0; i < this.commits.length; i++) {
            const commit = this.commits[i];
            const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
            
            if (branchRefs.length > 0) {
                const branchName = branchRefs[0].replace('Branch ', '');
                this.laneAssignments.set(commit.hash, branchLanes.get(branchName) || 0);
                
                // Propagate forwards through first parent (which is now to the right)
                if (commit.parents.length > 0) {
                    this.propagateBranchForwards(commit.parents[0], branchLanes.get(branchName) || 0);
                }
            }
        }

        // Third pass: assign lanes to remaining commits
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

        // Fourth pass: handle merge commits better
        this.handleMergeCommits();
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
        const text = ref.replace(/^(Branch|Tag)\s+/, '');
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
        const labelX = this.PADDING.left - 20;
        
        for (const [branchName, lane] of branchLanes) {
            const y = this.PADDING.top + lane * this.ROW_GAP;
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
