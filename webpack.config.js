const webpack = require('webpack');
const Qiniu = require('./src/index.js');
const CDN_HOST = `https://cdn.vwood.xyz`

module.exports = {
    mode: 'production',
    // devtool: "cheap-module-source-map",
    entry: __dirname + '/test/index.js',
    output: {
        path: __dirname + "/" + "/dist/",
        publicPath: '/',
        filename: "[name].[chunkhash].js",
    },
    plugins: [
        new Qiniu({
            accessKey: 'ZUeDQBNFMaae9jrxYmFNNNfaUUfhAFKyLbPutdZF',
            secretKey: 'Sb5MCKPs4bM-qexChWNHVL0QM0fgg575lYQAWnLL',
            bucket: 'vwood',
            zone: 'Zone_z2',
            exclude: /(\.html)|(\.map)/,
            domain: CDN_HOST,
        })
    ]
}