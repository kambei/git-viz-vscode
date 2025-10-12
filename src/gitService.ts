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

export interface BranchRelationship {
    branch: string;
    parentBranch?: string;
    mergeBase?: string;
    divergencePoint?: string;
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
    private cache: Map<string, { data: any; timestamp: number }> = new Map();
    private readonly CACHE_DURATION = 30000; // 30 seconds cache

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    private getCacheKey(method: string, params: any): string {
        return `${method}_${JSON.stringify(params)}`;
    }

    private getCachedData<T>(key: string): T | null {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
            return cached.data as T;
        }
        return null;
    }

    private setCachedData<T>(key: string, data: T): void {
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    async getCommits(filters: GitFilters = {}): Promise<GitCommit[]> {
        try {
            // Check cache first
            const cacheKey = this.getCacheKey('getCommits', filters);
            const cached = this.getCachedData<GitCommit[]>(cacheKey);
            if (cached) {
                console.log('Returning cached commits:', cached.length);
                return cached;
            }

            const maxCommits = filters.maxCommits || 200; // Reduced default for faster loading
            
            console.log('Getting commits from git folder:', this.workspaceRoot);
            console.log('Filters:', filters);
            
            // Check if we're in a git repository
            if (!await this.isGitRepository()) {
                console.log('Not a git repository');
                return [];
            }
            
            // Optimized git log command - use --oneline for faster parsing, then get full details
            // First get commit hashes and basic info
            let command = `git log --all --decorate=short --pretty=format:"%H|%h|%an|%ae|%s|%ai|%P|%D" --max-count=${maxCommits}`;
            
            // Add filters
            if (filters.branch) {
                const branchRefs = [
                    filters.branch,
                    `origin/${filters.branch}`,
                    `remotes/origin/${filters.branch}`
                ];
                command = `git log --decorate=short --pretty=format:"%H|%h|%an|%ae|%s|%ai|%P|%D" --max-count=${maxCommits} ${branchRefs.join(' ')}`;
            }
            
            if (filters.tag) {
                const tagRefs = [
                    filters.tag,
                    `refs/tags/${filters.tag}`,
                    `tags/${filters.tag}`
                ];
                command = `git log --decorate=short --pretty=format:"%H|%h|%an|%ae|%s|%ai|%P|%D" --max-count=${maxCommits} ${tagRefs.join(' ')}`;
            }
            
            if (filters.author) {
                command += ` --author="${filters.author}"`;
            }
            
            if (filters.message) {
                command += ` --grep="${filters.message}" --regexp-ignore-case`;
            }
            
            console.log('Executing optimized git command:', command);
            
            const { stdout, stderr } = await execAsync(command, { 
                cwd: this.workspaceRoot,
                encoding: 'utf8',
                maxBuffer: 1024 * 1024 * 10 // 10MB buffer for large repositories
            });
            
            if (stderr) {
                console.warn('Git command stderr:', stderr);
            }
            
            console.log('Git log output length:', stdout.length);
            
            const commits: GitCommit[] = [];
            const lines = stdout.trim().split('\n');
            
            // Optimized parsing - process in batches
            const batchSize = 100;
            for (let i = 0; i < lines.length; i += batchSize) {
                const batch = lines.slice(i, i + batchSize);
                
                for (const line of batch) {
                    if (line.trim()) {
                        const parts = line.split('|');
                        if (parts.length >= 8) {
                            try {
                                const refsString = parts[7].trim();
                                const refs: string[] = [];
                                
                                // Optimized ref parsing
                                if (refsString) {
                                    const refParts = refsString.split(', ');
                                    for (const ref of refParts) {
                                        const trimmedRef = ref.trim();
                                        if (trimmedRef) {
                                            if (trimmedRef.startsWith('tag: ')) {
                                                refs.push(`Tag ${trimmedRef.substring(5)}`);
                                            } else if (trimmedRef.startsWith('HEAD -> ')) {
                                                refs.push(`Branch ${trimmedRef.substring(8)}`);
                                            } else if (trimmedRef.startsWith('refs/heads/')) {
                                                refs.push(`Branch ${trimmedRef.substring(11)}`);
                                            } else if (trimmedRef.startsWith('refs/remotes/')) {
                                                const remoteBranch = trimmedRef.substring(13);
                                                const branchName = remoteBranch.startsWith('origin/') ? 
                                                    remoteBranch.substring(7) : remoteBranch;
                                                refs.push(`Branch ${branchName}`);
                                            } else if (trimmedRef.startsWith('refs/tags/')) {
                                                refs.push(`Tag ${trimmedRef.substring(10)}`);
                                            } else if (trimmedRef.startsWith('origin/')) {
                                                refs.push(`Branch ${trimmedRef.substring(7)}`);
                                            } else if (!trimmedRef.includes('->') && !trimmedRef.startsWith('refs/') && trimmedRef.length >= 3) {
                                                refs.push(`Branch ${trimmedRef}`);
                                            }
                                        }
                                    }
                                }
                                
                                const commit: GitCommit = {
                                    hash: parts[0].trim(),
                                    shortHash: parts[1].trim(),
                                    author: parts[2].trim(),
                                    authorEmail: parts[3].trim(),
                                    message: parts[4].trim(),
                                    fullMessage: parts[4].trim(),
                                    date: new Date(parts[5].trim()),
                                    parents: parts[6].trim() ? parts[6].trim().split(' ') : [],
                                    refs: refs
                                };
                                commits.push(commit);
                            } catch (error) {
                                console.warn('Error parsing commit line:', line, error);
                            }
                        }
                    }
                }
            }
            
            console.log('Successfully parsed commits:', commits.length);
            
            // Cache the result
            this.setCachedData(cacheKey, commits);
            
            return commits;
            
        } catch (error) {
            console.error('Error getting commits:', error);
            return [];
        }
    }

    async getBranches(): Promise<GitBranch[]> {
        try {
            // Check cache first
            const cacheKey = this.getCacheKey('getBranches', {});
            const cached = this.getCachedData<GitBranch[]>(cacheKey);
            if (cached) {
                console.log('Returning cached branches:', cached.length);
                return cached;
            }

            console.log('Getting branches from git folder...');
            
            if (!await this.isGitRepository()) {
                console.log('Not a git repository');
                return [];
            }
            
            // Optimized branch command - use --format for faster parsing
            const { stdout, stderr } = await execAsync('git branch -a --format="%(refname:short)|%(HEAD)" --sort=-committerdate', { 
                cwd: this.workspaceRoot,
                encoding: 'utf8'
            });
            
            if (stderr) {
                console.warn('Git branch stderr:', stderr);
            }
            
            const branches: GitBranch[] = [];
            const lines = stdout.split('\n');
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('remotes/origin/HEAD')) {
                    const parts = trimmed.split('|');
                    const name = parts[0].replace(/^remotes\/origin\//, '');
                    const isCurrent = parts[1] === '*';
                    
                    if (name && !name.includes('->')) {
                        branches.push({
                            name,
                            isCurrent,
                            lastCommit: ''
                        });
                    }
                }
            }
            
            console.log('Processed branches:', branches.length);
            
            // Cache the result
            this.setCachedData(cacheKey, branches);
            
            return branches;
            
        } catch (error) {
            console.error('Error getting branches:', error);
            return [];
        }
    }

    async getTags(): Promise<GitTag[]> {
        try {
            // Check cache first
            const cacheKey = this.getCacheKey('getTags', {});
            const cached = this.getCachedData<GitTag[]>(cacheKey);
            if (cached) {
                console.log('Returning cached tags:', cached.length);
                return cached;
            }

            console.log('Getting tags from git folder...');
            
            if (!await this.isGitRepository()) {
                console.log('Not a git repository');
                return [];
            }
            
            // Optimized tag command - get tag names and commits in one command
            const { stdout, stderr } = await execAsync('git tag --format="%(refname:short)|%(objectname)" --sort=-creatordate', { 
                cwd: this.workspaceRoot,
                encoding: 'utf8'
            });
            
            if (stderr) {
                console.warn('Git tag stderr:', stderr);
            }
            
            const tags: GitTag[] = [];
            const lines = stdout.split('\n');
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) {
                    const parts = trimmed.split('|');
                    if (parts.length >= 2) {
                        tags.push({
                            name: parts[0],
                            commit: parts[1]
                        });
                    }
                }
            }
            
            console.log('Processed tags:', tags.length);
            
            // Cache the result
            this.setCachedData(cacheKey, tags);
            
            return tags;
            
        } catch (error) {
            console.error('Error getting tags:', error);
            return [];
        }
    }

    async getAuthors(): Promise<string[]> {
        try {
            // Check cache first
            const cacheKey = this.getCacheKey('getAuthors', {});
            const cached = this.getCachedData<string[]>(cacheKey);
            if (cached) {
                console.log('Returning cached authors:', cached.length);
                return cached;
            }

            console.log('Getting authors from git folder...');
            
            if (!await this.isGitRepository()) {
                console.log('Not a git repository');
                return [];
            }
            
            // Optimized authors command - limit to recent commits for faster execution
            const { stdout, stderr } = await execAsync('git log --pretty=format:"%an" --max-count=1000 | sort | uniq', { 
                cwd: this.workspaceRoot,
                encoding: 'utf8'
            });
            
            if (stderr) {
                console.warn('Git authors stderr:', stderr);
            }
            
            const authors = [...new Set(stdout.split('\n').filter(Boolean))];
            console.log('Unique authors:', authors.length);
            
            // Cache the result
            this.setCachedData(cacheKey, authors);
            
            return authors;
            
        } catch (error) {
            console.error('Error getting authors:', error);
            return [];
        }
    }

    async getBranchRelationships(): Promise<BranchRelationship[]> {
        try {
            // Check cache first
            const cacheKey = this.getCacheKey('getBranchRelationships', {});
            const cached = this.getCachedData<BranchRelationship[]>(cacheKey);
            if (cached) {
                console.log('Returning cached branch relationships:', cached.length);
                return cached;
            }

            console.log('Getting branch relationships...');
            
            if (!await this.isGitRepository()) {
                console.log('Not a git repository');
                return [];
            }
            
            const branches = await this.getBranches();
            const relationships: BranchRelationship[] = [];
            
            // Process branches in parallel for better performance
            const branchPromises = branches.map(async (branch) => {
                try {
                    // Get the merge base with main/master branch
                    const mainBranches = ['main', 'master', 'develop'];
                    let parentBranch: string | undefined;
                    let mergeBase: string | undefined;
                    
                    for (const mainBranch of mainBranches) {
                        try {
                            const { stdout } = await execAsync(`git merge-base ${branch.name} ${mainBranch}`, { 
                                cwd: this.workspaceRoot,
                                encoding: 'utf8'
                            });
                            if (stdout.trim()) {
                                parentBranch = mainBranch;
                                mergeBase = stdout.trim();
                                break;
                            }
                        } catch (error) {
                            // Branch doesn't exist, continue
                        }
                    }
                    
                    // If no main branch found, try to find the most recent common ancestor
                    if (!parentBranch) {
                        try {
                            const { stdout } = await execAsync(`git merge-base --all ${branch.name} HEAD`, { 
                                cwd: this.workspaceRoot,
                                encoding: 'utf8'
                            });
                            if (stdout.trim()) {
                                mergeBase = stdout.trim();
                            }
                        } catch (error) {
                            console.warn(`Could not find merge base for branch ${branch.name}:`, error);
                        }
                    }
                    
                    return {
                        branch: branch.name,
                        parentBranch,
                        mergeBase
                    };
                    
                } catch (error) {
                    console.warn(`Error getting relationship for branch ${branch.name}:`, error);
                    return {
                        branch: branch.name,
                        parentBranch: undefined,
                        mergeBase: undefined
                    };
                }
            });
            
            const results = await Promise.all(branchPromises);
            relationships.push(...results);
            
            console.log('Branch relationships:', relationships.length);
            
            // Cache the result
            this.setCachedData(cacheKey, relationships);
            
            return relationships;
            
        } catch (error) {
            console.error('Error getting branch relationships:', error);
            return [];
        }
    }

    // Method to clear cache when needed
    clearCache(): void {
        this.cache.clear();
        console.log('Git service cache cleared');
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