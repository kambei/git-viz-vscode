import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

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
    lastCommit: string;
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

    async getCommits(filters: GitFilters = {}): Promise<GitCommit[]> {
        try {
            const maxCommits = filters.maxCommits || 500;
            const maxBranches = filters.maxBranches || 20;
            
            // Get latest branches first
            const branches = await this.getBranches();
            const latestBranches = branches.slice(0, maxBranches);
            
            // Build git log command
            let command = `git log --oneline --graph --decorate --all --max-count=${maxCommits}`;
            
            // Add branch filter if specified
            if (filters.branch) {
                command = `git log --oneline --graph --decorate --max-count=${maxCommits} origin/${filters.branch} || git log --oneline --graph --decorate --max-count=${maxCommits} ${filters.branch}`;
            }
            
            // Add author filter
            if (filters.author) {
                command += ` --author="${filters.author}"`;
            }
            
            // Add message filter
            if (filters.message) {
                command += ` --grep="${filters.message}"`;
            }
            
            // Add tag filter
            if (filters.tag) {
                command += ` --grep="${filters.tag}"`;
            }

            const { stdout } = await execAsync(command, { cwd: this.workspaceRoot });
            
            // Parse git log output
            const commits = this.parseGitLog(stdout);
            
            // Get detailed commit information
            const detailedCommits = await Promise.all(
                commits.map(async (commit) => {
                    const details = await this.getCommitDetails(commit.hash);
                    return {
                        hash: commit.hash,
                        shortHash: commit.shortHash,
                        author: details.author || 'Unknown',
                        authorEmail: details.authorEmail || '',
                        message: details.message || '',
                        fullMessage: details.fullMessage || '',
                        date: details.date || new Date(),
                        parents: details.parents || [],
                        refs: details.refs || []
                    } as GitCommit;
                })
            );

            return detailedCommits;
        } catch (error) {
            console.error('Error getting commits:', error);
            return [];
        }
    }

    async getBranches(): Promise<GitBranch[]> {
        try {
            const { stdout } = await execAsync('git branch -a --sort=-committerdate', { cwd: this.workspaceRoot });
            const branches: GitBranch[] = [];
            
            stdout.split('\n').forEach(line => {
                const trimmed = line.trim();
                if (trimmed) {
                    const isCurrent = trimmed.startsWith('*');
                    const name = trimmed.replace(/^\*\s*/, '').replace(/^remotes\/origin\//, '');
                    branches.push({
                        name,
                        isCurrent,
                        lastCommit: '' // Will be filled later
                    });
                }
            });
            
            return branches;
        } catch (error) {
            console.error('Error getting branches:', error);
            return [];
        }
    }

    async getTags(): Promise<GitTag[]> {
        try {
            const { stdout } = await execAsync('git tag --sort=-version:refname', { cwd: this.workspaceRoot });
            const tags: GitTag[] = [];
            
            stdout.split('\n').forEach(line => {
                const trimmed = line.trim();
                if (trimmed) {
                    tags.push({
                        name: trimmed,
                        commit: '' // Will be filled later
                    });
                }
            });
            
            return tags;
        } catch (error) {
            console.error('Error getting tags:', error);
            return [];
        }
    }

    async getAuthors(): Promise<string[]> {
        try {
            const { stdout } = await execAsync('git log --pretty=format:"%an" | sort | uniq', { cwd: this.workspaceRoot });
            return stdout.split('\n').filter(name => name.trim()).slice(0, 100); // Limit to 100 authors
        } catch (error) {
            console.error('Error getting authors:', error);
            return [];
        }
    }

    private parseGitLog(output: string): { hash: string; shortHash: string }[] {
        const commits: { hash: string; shortHash: string }[] = [];
        const lines = output.split('\n');
        
        for (const line of lines) {
            if (line.trim()) {
                // Extract hash from git log output
                const match = line.match(/^[|\s]*([a-f0-9]{7,40})/);
                if (match) {
                    commits.push({
                        hash: match[1],
                        shortHash: match[1].substring(0, 7)
                    });
                }
            }
        }
        
        return commits;
    }

    private async getCommitDetails(hash: string): Promise<Partial<GitCommit>> {
        try {
            const { stdout } = await execAsync(`git show --pretty=format:"%H|%an|%ae|%s|%B" --no-patch ${hash}`, { 
                cwd: this.workspaceRoot 
            });
            
            const lines = stdout.split('\n');
            const [fullHash, author, authorEmail, shortMessage, ...fullMessageLines] = lines[0].split('|');
            const fullMessage = fullMessageLines.join('\n');
            
            // Get parents
            const { stdout: parentsOutput } = await execAsync(`git show --pretty=format:"%P" --no-patch ${hash}`, { 
                cwd: this.workspaceRoot 
            });
            const parents = parentsOutput.trim().split(' ').filter(p => p);
            
            // Get refs
            const { stdout: refsOutput } = await execAsync(`git show-ref --tags --heads | grep ${hash}`, { 
                cwd: this.workspaceRoot 
            });
            const refs = refsOutput.split('\n')
                .map(line => line.trim())
                .filter(line => line)
                .map(line => {
                    const parts = line.split(' ');
                    if (parts.length >= 2) {
                        const refName = parts[1];
                        if (refName.startsWith('refs/heads/')) {
                            return `Branch ${refName.replace('refs/heads/', '')}`;
                        } else if (refName.startsWith('refs/tags/')) {
                            return `Tag ${refName.replace('refs/tags/', '')}`;
                        }
                        return refName;
                    }
                    return '';
                })
                .filter(ref => ref);

            return {
                hash: fullHash,
                shortHash: fullHash.substring(0, 7),
                author,
                authorEmail,
                message: shortMessage,
                fullMessage,
                parents,
                refs,
                date: new Date() // Will be filled with actual date if needed
            };
        } catch (error) {
            console.error(`Error getting commit details for ${hash}:`, error);
            return {};
        }
    }

    async isGitRepository(): Promise<boolean> {
        try {
            await execAsync('git rev-parse --git-dir', { cwd: this.workspaceRoot });
            return true;
        } catch {
            return false;
        }
    }
}
