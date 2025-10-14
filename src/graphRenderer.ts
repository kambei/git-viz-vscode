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
}

export class HorizontalGraphRenderer {
    private commits: GitCommit[];
    private nodes: GraphNode[] = [];
    private edges: GraphEdge[] = [];
    private laneAssignments: Map<string, number> = new Map();
    
    // Clean color palette
    private readonly colors = [
        '#1A73E8', // Blue for main
        '#34A853', // Green for dev
        '#FBBC05', // Yellow for test
        '#E91E63', // Pink for other branches
        '#00ACC1', // Cyan
        '#8E24AA', // Purple
        '#F4511E', // Orange
        '#7CB342'  // Light green
    ];

    // Layout constants
    private readonly COLUMN_GAP = 180;
    private readonly ROW_GAP = 80;
    private readonly NODE_RADIUS = 7;
    private readonly PADDING = { top: 96, right: 120, bottom: 96, left: 60 };

    constructor(commits: GitCommit[]) {
        // Reverse commits to show newest first (left to right)
        this.commits = [...commits].reverse();
        this.assignLanes();
        this.createNodes();
        this.createEdges();
    }

    private assignLanes(): void {
        // Simple branch hierarchy: main=0, dev=1, test=2, others=3+
        const branchLevels = new Map<string, number>();
        
        // Collect all unique branches
        const allBranches = new Set<string>();
        for (const commit of this.commits) {
            const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
            branchRefs.forEach(ref => {
                const branchName = ref.replace('Branch ', '');
                allBranches.add(branchName);
            });
        }

        // Assign levels based on simple hierarchy
        let currentLevel = 0;
        for (const branch of allBranches) {
            if (branch.toLowerCase() === 'main' || branch.toLowerCase() === 'master') {
                branchLevels.set(branch, 0);
            } else if (branch.toLowerCase() === 'dev' || branch.toLowerCase() === 'develop') {
                branchLevels.set(branch, 1);
            } else if (branch.toLowerCase() === 'test' || branch.toLowerCase() === 'testing') {
                branchLevels.set(branch, 2);
            } else {
                branchLevels.set(branch, currentLevel + 3);
                currentLevel++;
            }
        }

        // Assign lanes to commits
        for (const commit of this.commits) {
            const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
            const branchNames = branchRefs.map(ref => ref.replace('Branch ', ''));
            
            if (branchNames.length === 0) {
                // No branch refs - assign to main
                this.laneAssignments.set(commit.hash, 0);
            } else if (branchNames.length === 1) {
                // Single branch - assign to that branch's level
                const branchName = branchNames[0];
                const level = branchLevels.get(branchName) || 0;
                this.laneAssignments.set(commit.hash, level);
            } else {
                // Multiple branches - prefer non-main branch
                const mainBranches = ['main', 'master'];
                const nonMainBranch = branchNames.find(name => !mainBranches.includes(name.toLowerCase()));
                
                if (nonMainBranch) {
                    const level = branchLevels.get(nonMainBranch) || 0;
                    this.laneAssignments.set(commit.hash, level);
                } else {
                    this.laneAssignments.set(commit.hash, 0);
                }
            }
        }

        // Ensure horizontal continuity for each branch
        this.ensureHorizontalContinuity();
    }

    private ensureHorizontalContinuity(): void {
        // Group commits by their assigned lane
        const commitsByLane = new Map<number, GitCommit[]>();
        
        for (const commit of this.commits) {
            const lane = this.laneAssignments.get(commit.hash) || 0;
            if (!commitsByLane.has(lane)) {
                commitsByLane.set(lane, []);
            }
            commitsByLane.get(lane)!.push(commit);
        }

        // For each lane, ensure commits maintain horizontal continuity
        for (const [lane, commits] of commitsByLane) {
            // Sort commits by their position in the original array (chronological order)
            commits.sort((a, b) => {
                const indexA = this.commits.findIndex(c => c.hash === a.hash);
                const indexB = this.commits.findIndex(c => c.hash === b.hash);
                return indexA - indexB;
            });

            // Ensure all commits in this lane stay at the same level
            for (const commit of commits) {
                this.laneAssignments.set(commit.hash, lane);
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
                    const isMerge = commit.parents.length > 1;
                    
                    this.edges.push({
                        from: node,      // Child (newer commit, on the left)
                        to: parentNode, // Parent (older commit, on the right)
                        color: i === 0 ? node.color : parentNode.color,
                        isMerge: isMerge
                    });
                }
            }
        }
    }

    private renderEdge(edge: GraphEdge): string {
        const { from, to, color, isMerge } = edge;
        const dx = Math.max(10, to.x - from.x);
        const dy = to.y - from.y;
        
        let pathData: string;
        let strokeWidth: number;
        let opacity: number;
        let markerEnd: string;
        
        if (Math.abs(dy) < 1) {
            // Same lane - draw straight horizontal line
            pathData = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
            strokeWidth = isMerge ? 2.5 : 2;
            opacity = isMerge ? 0.9 : 0.8;
            markerEnd = isMerge ? 'url(#merge-arrowhead)' : 'url(#arrowhead)';
        } else {
            // Different lanes - draw curved line
            const cx1 = from.x + dx / 2;
            const cx2 = to.x - dx / 2;
            
            pathData = `M ${from.x} ${from.y} C ${cx1} ${from.y}, ${cx2} ${to.y}, ${to.x} ${to.y}`;
            strokeWidth = isMerge ? 2.5 : 2;
            opacity = isMerge ? 0.9 : 0.8;
            markerEnd = isMerge ? 'url(#merge-arrowhead)' : 'url(#arrowhead)';
        }
        
        return `
            <path d="${pathData}"
                  stroke="${color}" 
                  stroke-width="${strokeWidth}" 
                  fill="none" 
                  opacity="${opacity}"
                  marker-end="${markerEnd}"/>
        `;
    }

    private renderNode(node: GraphNode): string {
        const { commit, x, y, color } = node;
        
        let svg = `
            <circle cx="${x}" cy="${y}" r="${this.NODE_RADIUS}" 
                    fill="${color}" stroke="white" stroke-width="2" 
                    class="commit-node" data-hash="${commit.hash}"/>
        `;

        // Render commit info
        const sha = commit.shortHash;
        const author = commit.author || 'Unknown';
        const message = commit.message || 'No message';
        
        svg += `
            <text x="${x}" y="${y - 25}" class="commit-text" text-anchor="middle">
                ${sha} · ${this.truncateText(author, 15)}
            </text>
            <text x="${x}" y="${y + 35}" class="commit-text" text-anchor="middle">
                ${this.truncateText(message, 25)}
            </text>
        `;

        // Render branch labels
        if (commit.refs.length > 0) {
            const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
            const branchNames = branchRefs.map(ref => ref.replace('Branch ', ''));
            
            for (let i = 0; i < Math.min(branchNames.length, 3); i++) {
                const branchName = branchNames[i];
                const badgeY = y - 45 - (i * 20);
                
                svg += `
                    <rect x="${x - 20}" y="${badgeY - 8}" width="40" height="16" 
                          rx="8" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.3)"/>
                    <text x="${x}" y="${badgeY + 2}" class="branch-label" text-anchor="middle">
                        ${branchName}
                    </text>
                `;
            }
        }
        
        return svg;
    }

    private truncateText(text: string, maxLength: number): string {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
    }

    render(): string {
        const width = this.PADDING.left + this.PADDING.right + this.commits.length * this.COLUMN_GAP;
        const height = this.PADDING.top + this.PADDING.bottom + this.getMaxLane() * this.ROW_GAP;
        
        let svg = `
            <svg width="${width}" height="${height}" 
                 viewBox="0 0 ${width} ${height}" 
                 style="background: #1e1e1e; font-family: 'Segoe UI', sans-serif;">
                
                <defs>
                    <marker id="arrowhead" markerWidth="10" markerHeight="7" 
                            refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="currentColor"/>
                    </marker>
                    <marker id="merge-arrowhead" markerWidth="12" markerHeight="8" 
                            refX="11" refY="4" orient="auto">
                        <polygon points="0 0, 12 4, 0 8" fill="currentColor"/>
                    </marker>
                </defs>
                
                <style>
                    .commit-text { fill: #ffffff; font-size: 12px; }
                    .branch-label { fill: #ffffff; font-size: 10px; font-weight: bold; }
                    .commit-node:hover { stroke-width: 3; }
                </style>
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

    private getMaxLane(): number {
        let maxLane = 0;
        for (const lane of this.laneAssignments.values()) {
            maxLane = Math.max(maxLane, lane);
        }
        return maxLane;
    }

    // Gradual rendering support (simplified)
    renderGradually(): { svg: string; progress: number; isComplete: boolean } {
        // For now, just return the full render
        return {
            svg: this.render(),
            progress: 100,
            isComplete: true
        };
    }

    getRenderingProgress(): number {
        return 100;
    }

    isRenderingFinished(): boolean {
        return true;
    }
}