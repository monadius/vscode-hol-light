//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
module.exports = (_env, argv) => {
  const isProd = argv.mode === 'production';
  
  return [
    // Extension (runs in Node)
    {
      mode: argv.mode || 'none',
      target: 'node',
      entry: {
        extension: './src/extension.ts'
      },
      output: {
        path: path.resolve(__dirname, 'out'),
        filename: '[name].js',
        libraryTarget: 'commonjs2'
      },
      resolve: {
        extensions: ['.ts', '.js']
      },
      module: {
        rules: [{ test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ }]
      },
      externals: { vscode: 'commonjs vscode' }
    },

    // Webview (runs in browser)
    {
      mode: argv.mode || 'none',
      target: 'web',
      entry: {
        goalview: './src/goalview/index.tsx'
      },
      output: {
        path: path.resolve(__dirname, 'out'),
        filename: '[name].js'
      },
      resolve: {
        extensions: ['.ts', '.tsx', '.js']
      },
      plugins: isProd ? [] : [
        new webpack.DefinePlugin({
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'process.env.NODE_ENV': JSON.stringify('development')
        })
      ],
      module: {
        rules: [
          { test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ },
          { test: /\.css$/, use: ['style-loader', 'css-loader'] }
        ]
      }
    }
  ];
};