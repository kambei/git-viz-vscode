const path = require('path');

module.exports = [
    // Extension webpack config
    {
        mode: 'production',
        entry: './src/extension.tsx',
        target: 'node',
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: 'ts-loader',
                    exclude: /node_modules/,
                },
            ],
        },
        resolve: {
            extensions: ['.tsx', '.ts', '.js', '.jsx'],
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
    },
    // Webview webpack config
    {
        mode: 'production',
        entry: './src/webview.tsx',
        target: 'web',
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: 'ts-loader',
                    exclude: /node_modules/,
                    options: {
                        compilerOptions: {
                            target: 'es5',
                            module: 'esnext',
                            jsx: 'react-jsx'
                        }
                    }
                },
            ],
        },
        resolve: {
            extensions: ['.tsx', '.ts', '.js', '.jsx'],
        },
        output: {
            filename: 'webview.js',
            path: path.resolve(__dirname, 'out'),
            libraryTarget: 'var',
            library: 'GitVizWebview',
        },
        externals: {
            'react': 'React',
            'react-dom': 'ReactDOM'
        },
        optimization: {
            minimize: false,
        },
    },
];
