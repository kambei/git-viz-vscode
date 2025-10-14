import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

// Types
interface GitCommit {
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

interface GitBranch {
    name: string;
    isCurrent: boolean;
}

interface GitTag {
    name: string;
    commit: string;
}

interface GitFilters {
    branch?: string;
    tag?: string;
    author?: string;
    message?: string;
    maxCommits?: number;
    maxBranches?: number;
}

interface GitData {
    commits: GitCommit[];
    branches: GitBranch[];
    tags: GitTag[];
    authors: string[];
    filters: GitFilters;
    status: string;
}

// Components
const Toolbar: React.FC<{
    status: string;
    onShowLimits: () => void;
    onReset: () => void;
    onZoomOut: () => void;
    onZoomIn: () => void;
}> = ({ status, onShowLimits, onReset, onZoomOut, onZoomIn }) => (
    <div className="toolbar">
        <div className="status">{status}</div>
        <div className="controls">
            <button className="btn" onClick={onShowLimits}>Limits…</button>
            <button className="btn" onClick={onReset}>Reset</button>
            <button className="btn" onClick={onZoomOut}>-</button>
            <button className="btn" onClick={onZoomIn}>+</button>
        </div>
    </div>
);

const Filters: React.FC<{
    branches: GitBranch[];
    tags: GitTag[];
    authors: string[];
    onApplyFilters: (filters: GitFilters) => void;
    onClearFilters: () => void;
}> = ({ branches, tags, authors, onApplyFilters, onClearFilters }) => {
    const [branchFilter, setBranchFilter] = useState('');
    const [tagFilter, setTagFilter] = useState('');
    const [authorFilter, setAuthorFilter] = useState('');
    const [messageFilter, setMessageFilter] = useState('');

    const handleApply = () => {
        onApplyFilters({
            branch: branchFilter || undefined,
            tag: tagFilter || undefined,
            author: authorFilter || undefined,
            message: messageFilter || undefined,
        });
    };

    const handleClear = () => {
        setBranchFilter('');
        setTagFilter('');
        setAuthorFilter('');
        setMessageFilter('');
        onClearFilters();
    };

    return (
        <div className="filters">
            <div className="filter-group">
                <label>Branch:</label>
                <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
                    <option value="">All branches</option>
                    {branches.map(branch => (
                        <option key={branch.name} value={branch.name}>
                            {branch.name}{branch.isCurrent ? ' (current)' : ''}
                        </option>
                    ))}
                </select>
            </div>
            <div className="filter-group">
                <label>Tag:</label>
                <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                    <option value="">All tags</option>
                    {tags.map(tag => (
                        <option key={tag.name} value={tag.name}>{tag.name}</option>
                    ))}
                </select>
            </div>
            <div className="filter-group">
                <label>Author:</label>
                <select value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)}>
                    <option value="">All authors</option>
                    {authors.map(author => (
                        <option key={author} value={author}>{author}</option>
                    ))}
                </select>
            </div>
            <div className="filter-group">
                <label>Message:</label>
                <input 
                    type="text" 
                    value={messageFilter}
                    onChange={(e) => setMessageFilter(e.target.value)}
                    placeholder="Search in messages" 
                />
            </div>
            <button className="btn" onClick={handleApply}>Apply</button>
            <button className="btn" onClick={handleClear}>Clear</button>
        </div>
    );
};

const CommitNode: React.FC<{
    commit: GitCommit;
    x: number;
    y: number;
    color: string;
    onClick: (commit: GitCommit) => void;
}> = ({ commit, x, y, color, onClick }) => (
    <g>
        <circle 
            cx={x} 
            cy={y} 
            r="7"
            fill={color}
            stroke="white"
            strokeWidth="2"
            className="commit-node"
            onClick={() => onClick(commit)}
            style={{ cursor: 'pointer' }}
        />
        <text 
            x={x} 
            y={y - 20} 
            className="commit-text" 
            textAnchor="middle"
            style={{ fontSize: '12px', fill: '#ffffff' }}
        >
            {commit.shortHash}
        </text>
        <text 
            x={x} 
            y={y - 5} 
            className="commit-text" 
            textAnchor="middle"
            style={{ fontSize: '10px', fill: '#cccccc' }}
        >
            {commit.author.length > 15 ? commit.author.substring(0, 15) + '...' : commit.author}
        </text>
        <text 
            x={x} 
            y={y + 30} 
            className="commit-text" 
            textAnchor="middle"
            style={{ fontSize: '12px', fill: '#ffffff' }}
        >
            {commit.message.length > 20 ? commit.message.substring(0, 20) + '...' : commit.message}
        </text>
    </g>
);

const GitGraph: React.FC<{
    commits: GitCommit[];
    onCommitClick: (commit: GitCommit) => void;
}> = ({ commits, onCommitClick }) => {
    if (commits.length === 0) {
        return <div className="error">No commits found</div>;
    }

    const reversedCommits = [...commits].reverse();
    const branchColors: { [key: string]: string } = {};
    const commitBranches: { [key: string]: string } = {};
    const branchLanes: { [key: string]: number } = {};
    let nextLane = 0;
    let nextColorIndex = 0;

    const colors = ['#1A73E8', '#34A853', '#FBBC05', '#E91E63', '#00ACC1', '#8E24AA', '#F4511E', '#7CB342'];

    // Assign branches and colors with HEAD tracking
    let currentBranch = 'main'; // Track the currently checked out branch
    
    reversedCommits.forEach(commit => {
        const branchRefs = commit.refs.filter(ref => ref.startsWith('Branch '));
        const branchNames = branchRefs.map(ref => ref.replace('Branch ', ''));
        
        // Check if this commit has HEAD -> (indicating a branch checkout)
        const headRef = commit.refs.find(ref => ref.includes('HEAD -> '));
        if (headRef) {
            const headBranch = headRef.replace('Branch HEAD -> ', '').trim();
            currentBranch = headBranch;
        }
        
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
        
        let branchName = currentBranch; // Use current branch as default
        
        // Override with explicit branch detection if available
        if (isTestBranch) {
            branchName = 'test';
        } else if (isDevBranch) {
            branchName = 'dev';
        } else if (isMainBranch) {
            branchName = 'main';
        } else if (branchNames.length > 0) {
            branchName = branchNames[0];
        }
        
        commitBranches[commit.hash] = branchName;
        
        if (!branchColors[branchName]) {
            branchColors[branchName] = colors[nextColorIndex % colors.length];
            branchLanes[branchName] = nextLane;
            nextColorIndex++;
            nextLane++;
        }
    });

    const maxLanes = Math.max(Object.keys(branchLanes).length, 1);
    const width = 100 + reversedCommits.length * 180;
    const height = 200 + maxLanes * 80;

    return (
        <svg 
            className="graph-svg" 
            width={width} 
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            style={{ background: '#1e1e1e', fontFamily: "'Segoe UI', sans-serif" }}
        >
            <defs>
                <marker 
                    id="arrowhead" 
                    markerWidth="10" 
                    markerHeight="7" 
                    refX="9" 
                    refY="3.5" 
                    orient="auto"
                >
                    <polygon points="0 0, 10 3.5, 0 7" fill="currentColor"/>
                </marker>
            </defs>
            <style>
                {`
                    .commit-text { fill: #ffffff; font-size: 12px; }
                    .commit-node:hover { stroke-width: 3; }
                    .branch-label { fill: #ffffff; font-size: 10px; font-weight: bold; }
                `}
            </style>
            
            {reversedCommits.map((commit, index) => {
                const x = 50 + index * 180;
                const branchName = commitBranches[commit.hash] || 'main';
                const lane = branchLanes[branchName] || 0;
                const y = 100 + lane * 80;
                const color = branchColors[branchName] || colors[0];

                return (
                    <g key={commit.hash}>
                        {/* Connection line */}
                        {index > 0 && (
                            <path 
                                d={`M ${50 + (index - 1) * 180} ${100 + (branchLanes[commitBranches[reversedCommits[index - 1].hash]] || 0) * 80} L ${x} ${y}`}
                                stroke={color}
                                strokeWidth="2"
                                fill="none"
                                opacity="0.8"
                                markerEnd="url(#arrowhead)"
                            />
                        )}
                        
                        {/* Commit node */}
                        <CommitNode 
                            commit={commit}
                            x={x}
                            y={y}
                            color={color}
                            onClick={onCommitClick}
                        />
                        
                        {/* Branch and tag labels */}
                        {commit.refs.map((ref, idx) => {
                            const labelY = y - 40 - (idx * 15);
                            if (ref.startsWith('Branch ')) {
                                const branchName = ref.replace('Branch ', '');
                                return (
                                    <text 
                                        key={idx}
                                        x={x} 
                                        y={labelY} 
                                        className="branch-label" 
                                        textAnchor="middle"
                                    >
                                        {branchName}
                                    </text>
                                );
                            } else if (ref.startsWith('Tag ')) {
                                const tagName = ref.replace('Tag ', '');
                                return (
                                    <text 
                                        key={idx}
                                        x={x} 
                                        y={labelY} 
                                        className="branch-label" 
                                        textAnchor="middle"
                                        style={{ fill: '#ffd700' }}
                                    >
                                        {tagName}
                                    </text>
                                );
                            }
                            return null;
                        })}
                    </g>
                );
            })}
        </svg>
    );
};

const GitVisualization: React.FC = () => {
    const [data, setData] = useState<GitData | null>(null);
    const [status, setStatus] = useState('Loading...');
    const [currentScale, setCurrentScale] = useState(1.0);
    const [currentTranslate, setCurrentTranslate] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Listen for messages from the extension
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'updateStatus':
                    setStatus(message.status);
                    break;
                case 'updateGitData':
                    setData(message);
                    setStatus(message.status || 'Ready');
                    break;
                case 'zoomIn':
                    zoomIn();
                    break;
                case 'zoomOut':
                    zoomOut();
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        
        // Request initial data
        const vscode = (window as any).acquireVsCodeApi();
        vscode.postMessage({ command: 'loadGitData' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    const zoomIn = () => {
        setCurrentScale(prev => Math.min(prev * 1.1, 3.0));
    };

    const zoomOut = () => {
        setCurrentScale(prev => Math.max(prev / 1.1, 0.5));
    };

    const resetView = () => {
        setCurrentScale(1.0);
        setCurrentTranslate({ x: 0, y: 0 });
    };

    const applyZoom = () => {
        const svg = containerRef.current?.querySelector('.graph-svg') as HTMLElement;
        if (svg) {
            svg.style.transform = `translate(${currentTranslate.x}px, ${currentTranslate.y}px) scale(${currentScale})`;
            svg.style.transformOrigin = 'center center';
        }
    };

    useEffect(() => {
        applyZoom();
    }, [currentScale, currentTranslate]);

    const handleCommitClick = (commit: GitCommit) => {
        const vscode = (window as any).acquireVsCodeApi();
        vscode.postMessage({
            command: 'showCommitDetails',
            commit: commit
        });
    };

    const handleApplyFilters = (filters: GitFilters) => {
        const vscode = (window as any).acquireVsCodeApi();
        vscode.postMessage({
            command: 'applyFilters',
            filters: filters
        });
    };

    const handleClearFilters = () => {
        const vscode = (window as any).acquireVsCodeApi();
        vscode.postMessage({
            command: 'applyFilters',
            filters: {}
        });
    };

    const handleShowLimits = () => {
        // Implementation for limits dialog
        console.log('Show limits dialog');
    };

    return (
        <div className="container">
            <Toolbar 
                status={status}
                onShowLimits={handleShowLimits}
                onReset={resetView}
                onZoomOut={zoomOut}
                onZoomIn={zoomIn}
            />
            
            {data && (
                <Filters 
                    branches={data.branches}
                    tags={data.tags}
                    authors={data.authors}
                    onApplyFilters={handleApplyFilters}
                    onClearFilters={handleClearFilters}
                />
            )}
            
            <div className="graph-container" ref={containerRef}>
                {data ? (
                    <GitGraph 
                        commits={data.commits}
                        onCommitClick={handleCommitClick}
                    />
                ) : (
                    <div className="loading">Loading git data...</div>
                )}
            </div>
        </div>
    );
};

// Export function to render the webview
export function renderWebview() {
    const container = document.getElementById('root');
    if (container) {
        ReactDOM.render(<GitVisualization />, container);
    }
}

// Auto-render when the script loads
if (typeof window !== 'undefined') {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderWebview);
    } else {
        renderWebview();
    }
}

// CSS styles (you can move this to a separate CSS file)
export const webviewStyles = `
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
`;
