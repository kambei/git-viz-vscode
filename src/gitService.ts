import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

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
            
            console.log('Getting commits from git folder:', this.workspaceRoot);
            console.log('Filters:', filters);
            
            // Check if we're in a git repository
            if (!await this.isGitRepository()) {
                console.log('Not a git repository');
                return [];
            }
            
            // Build git log command with structured output
            let command = `git log --pretty=format:"%H|%h|%an|%ae|%s|%ai|%P" --max-count=${maxCommits}`;
            
            // Add filters
            if (filters.branch) {
                command += ` ${filters.branch}`;
            }
            
            if (filters.author) {
                command += ` --author="${filters.author}"`;
            }
            
            if (filters.message) {
                command += ` --grep="${filters.message}"`;
            }
            
            console.log('Executing git command:', command);
            
            const { stdout, stderr } = await execAsync(command, { 
                cwd: this.workspaceRoot,
                encoding: 'utf8'
            });
            
            if (stderr) {
                console.warn('Git command stderr:', stderr);
            }
            
            console.log('Git log output length:', stdout.length);
            
            const commits: GitCommit[] = [];
            const lines = stdout.trim().split('\n');
            
            for (const line of lines) {
                if (line.trim()) {
                    const parts = line.split('|');
                    if (parts.length >= 7) {
                        try {
                            const commit: GitCommit = {
                                hash: parts[0].trim(),
                                shortHash: parts[1].trim(),
                                author: parts[2].trim(),
                                authorEmail: parts[3].trim(),
                                message: parts[4].trim(),
                                fullMessage: parts[4].trim(), // Same as message for now
                                date: new Date(parts[5].trim()),
                                parents: parts[6].trim() ? parts[6].trim().split(' ') : [],
                                refs: []
                            };
                            commits.push(commit);
                        } catch (error) {
                            console.warn('Error parsing commit line:', line, error);
                        }
                    } else {
                        console.warn('Invalid commit line format:', line);
                    }
                }
            }
            
            console.log('Successfully parsed commits:', commits.length);
            return commits;
            
        } catch (error) {
            console.error('Error getting commits:', error);
            return [];
        }
    }

    async getBranches(): Promise<GitBranch[]> {
        try {
            console.log('Getting branches from git folder...');
            
            if (!await this.isGitRepository()) {
                console.log('Not a git repository');
                return [];
            }
            
            const { stdout, stderr } = await execAsync('git branch -a --sort=-committerdate', { 
                cwd: this.workspaceRoot,
                encoding: 'utf8'
            });
            
            if (stderr) {
                console.warn('Git branch stderr:', stderr);
            }
            
            console.log('Git branch output:', stdout);
            
            const branches: GitBranch[] = [];
            const lines = stdout.split('\n');
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('remotes/origin/HEAD')) {
                    const isCurrent = trimmed.startsWith('*');
                    const name = trimmed.replace(/^\*\s*/, '').replace(/^remotes\/origin\//, '');
                    
                    if (name && !name.includes('->')) {
                        branches.push({
                            name,
                            isCurrent,
                            lastCommit: '' // We'll get this separately if needed
                        });
                    }
                }
            }
            
            console.log('Processed branches:', branches);
            return branches;
            
        } catch (error) {
            console.error('Error getting branches:', error);
            return [];
        }
    }

    async getTags(): Promise<GitTag[]> {
        try {
            console.log('Getting tags from git folder...');
            
            if (!await this.isGitRepository()) {
                console.log('Not a git repository');
                return [];
            }
            
            const { stdout, stderr } = await execAsync('git tag --sort=-creatordate', { 
                cwd: this.workspaceRoot,
                encoding: 'utf8'
            });
            
            if (stderr) {
                console.warn('Git tag stderr:', stderr);
            }
            
            console.log('Git tags output:', stdout);
            
            const tags: GitTag[] = [];
            const lines = stdout.split('\n');
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) {
                    try {
                        const { stdout: commitHash } = await execAsync(`git rev-parse ${trimmed}`, { 
                            cwd: this.workspaceRoot,
                            encoding: 'utf8'
                        });
                        tags.push({
                            name: trimmed,
                            commit: commitHash.trim()
                        });
                    } catch (error) {
                        console.warn(`Could not get commit for tag ${trimmed}:`, error);
                    }
                }
            }
            
            console.log('Processed tags:', tags);
            return tags;
            
        } catch (error) {
            console.error('Error getting tags:', error);
            return [];
        }
    }

    async getAuthors(): Promise<string[]> {
        try {
            console.log('Getting authors from git folder...');
            
            if (!await this.isGitRepository()) {
                console.log('Not a git repository');
                return [];
            }
            
            const { stdout, stderr } = await execAsync('git log --pretty=format:"%an" --max-count=1000', { 
                cwd: this.workspaceRoot,
                encoding: 'utf8'
            });
            
            if (stderr) {
                console.warn('Git authors stderr:', stderr);
            }
            
            console.log('Git authors output:', stdout);
            
            const authors = [...new Set(stdout.split('\n').filter(Boolean))];
            console.log('Unique authors:', authors);
            return authors;
            
        } catch (error) {
            console.error('Error getting authors:', error);
            return [];
        }
    }

    async getCommitDetails(hash: string): Promise<Partial<GitCommit>> {
        try {
            console.log('Getting commit details for:', hash);
            
            if (!await this.isGitRepository()) {
                console.log('Not a git repository');
                return {};
            }
            
            const { stdout, stderr } = await execAsync(`git show --pretty=format:"%H|%an|%ae|%s|%B" --no-patch ${hash}`, { 
                cwd: this.workspaceRoot,
                encoding: 'utf8'
            });
            
            if (stderr) {
                console.warn('Git show stderr:', stderr);
            }
            
            const parts = stdout.split('|');
            if (parts.length >= 4) {
                return {
                    hash: parts[0].trim(),
                    author: parts[1].trim(),
                    authorEmail: parts[2].trim(),
                    message: parts[3].trim(),
                    fullMessage: parts.slice(4).join('|').trim()
                };
            }
            
            return {};
        } catch (error) {
            console.error(`Error getting commit details for ${hash}:`, error);
            return {};
        }
    }

    async isGitRepository(): Promise<boolean> {
        try {
            console.log('Checking if git repository in:', this.workspaceRoot);
            
            // First check if .git directory exists
            const gitDir = path.join(this.workspaceRoot, '.git');
            const gitDirExists = fs.existsSync(gitDir);
            console.log('.git directory exists:', gitDirExists);
            
            if (!gitDirExists) {
                return false;
            }
            
            // Then verify with git command
            const { stdout, stderr } = await execAsync('git rev-parse --git-dir', { 
                cwd: this.workspaceRoot,
                encoding: 'utf8'
            });
            
            if (stderr) {
                console.warn('Git rev-parse stderr:', stderr);
            }
            
            const isRepo = stdout.trim() !== '';
            console.log('Git command confirms repository:', isRepo);
            return isRepo;
            
        } catch (error) {
            console.error('Git repository check failed:', error);
            return false;
        }
    }
}