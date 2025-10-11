const path = require('path');

module.exports = {
    mode: 'production',
    entry: './src/extension.ts',
    target: 'node',
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    output: {
        filename: 'extension.js',
        path: path.resolve(__dirname, 'out'),
        libraryTarget: 'commonjs2',
    },
    externals: {
        vscode: 'commonjs vscode',
    },
    optimization: {
        minimize: false,
    },
};
