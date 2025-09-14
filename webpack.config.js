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
      devtool: 'nosources-source-map',
      module: {
        rules: [{ test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ }]
      },
      externals: { vscode: 'commonjs vscode' }
    },

  ];
};