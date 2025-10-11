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
    private readonly PADDING = { top: 96, right: 64, bottom: 96, left: 64 };

    constructor(commits: GitCommit[]) {
        this.commits = commits;
        this.assignLanes();
        this.createNodes();
        this.createEdges();
    }

    private assignLanes(): void {
        // Assign lanes based on branch names from refs
        const branchLanes = new Map<string, number>();
        let nextLane = 0;

        // First pass: assign lanes to commits with branch refs
        for (let i = 0; i < this.commits.length; i++) {
            const commit = this.commits[i];
            const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
            
            if (branchRefs.length > 0) {
                const branchName = branchRefs[0].replace('Branch ', '');
                if (!branchLanes.has(branchName)) {
                    branchLanes.set(branchName, nextLane++);
                }
            }
        }

        // Second pass: propagate branch assignments backwards through first-parent chains
        for (let i = this.commits.length - 1; i >= 0; i--) {
            const commit = this.commits[i];
            const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
            
            if (branchRefs.length > 0) {
                const branchName = branchRefs[0].replace('Branch ', '');
                this.laneAssignments.set(commit.hash, branchLanes.get(branchName) || 0);
                
                // Propagate backwards through first parent
                if (commit.parents.length > 0) {
                    this.propagateBranchBackwards(commit.parents[0], branchLanes.get(branchName) || 0);
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
    }

    private propagateBranchBackwards(parentHash: string, lane: number): void {
        const parentIndex = this.commits.findIndex(c => c.hash.startsWith(parentHash));
        if (parentIndex !== -1 && !this.laneAssignments.has(this.commits[parentIndex].hash)) {
            this.laneAssignments.set(this.commits[parentIndex].hash, lane);
            
            // Continue propagating if this commit has a first parent
            const parentCommit = this.commits[parentIndex];
            if (parentCommit.parents.length > 0) {
                this.propagateBranchBackwards(parentCommit.parents[0], lane);
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
                    this.edges.push({
                        from: node,
                        to: parentNode,
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
                        .commit-author {
                            fill: var(--vscode-descriptionForeground);
                            font-size: 10px;
                            text-anchor: middle;
                        }
                        .commit-message {
                            fill: var(--vscode-foreground);
                            font-size: 10px;
                            text-anchor: middle;
                        }
                        .ref-badge {
                            fill: var(--vscode-button-background);
                            stroke: var(--vscode-button-border);
                            stroke-width: 1;
                        }
                        .ref-text {
                            fill: var(--vscode-button-foreground);
                            font-size: 9px;
                            text-anchor: middle;
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

        // Render SHA and author above the node
        const sha = commit.shortHash;
        const author = commit.author || 'Unknown';
        const topText = `${sha} · ${author}`;
        
        svg += `
            <text x="${x}" y="${y - this.NODE_RADIUS - 8}" class="commit-text">
                ${this.truncateText(topText, 20)}
            </text>
        `;

        // Render commit message below the node
        const message = commit.message || '';
        svg += `
            <text x="${x}" y="${y + this.NODE_RADIUS + 15}" class="commit-message">
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
        const text = ref.replace(/^(Branch|Tag)\s+/, '');
        const width = Math.max(40, text.length * 6);
        const height = 16;
        
        return `
            <rect x="${x - width/2}" y="${y - height/2}" width="${width}" height="${height}" 
                  rx="8" ry="8" class="ref-badge"/>
            <text x="${x}" y="${y + 3}" class="ref-text">${text}</text>
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
