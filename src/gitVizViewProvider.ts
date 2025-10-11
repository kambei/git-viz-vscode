import * as vscode from 'vscode';

export class GitVizViewProvider implements vscode.TreeDataProvider<GitVizItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<GitVizItem | undefined | null | void> = new vscode.EventEmitter<GitVizItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<GitVizItem | undefined | null | void> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: GitVizItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: GitVizItem): Thenable<GitVizItem[]> {
        if (!element) {
            return Promise.resolve([
                new GitVizItem('Open Git Visualization', 'git-viz.open', 'Open the Git visualization panel'),
                new GitVizItem('Refresh', 'git-viz.refresh', 'Refresh the Git data'),
            ]);
        }
        return Promise.resolve([]);
    }
}

class GitVizItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly commandId: string,
        public readonly tooltip: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.command = {
            command: commandId,
            title: label,
        };
        this.tooltip = tooltip;
    }
}
