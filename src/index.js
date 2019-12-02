const qiniu = require("qiniu");
const fs = require("fs");
const moment = require("moment");
const _array = require("lodash/array");
const _difference = require("lodash/difference");
const _flatMap = require("lodash/flatMap");
const _isFunction = require('lodash/isfunction')
const crypto = require("crypto");
/**
 * options: {
 * cache: false, 开启文件缓存，记录上次上传文件，下次上传前对比文件hash值，一样就不上传, 默认false
 * accessKey:
 * secretKey:
 * bucket:
 * domain: cdn域名
 * dir: 上传文件夹，默认打包的文件夹
 * zone: 区域，默认Zone_z1
 * excludes: 排除的文件[]
 * refreshFilter: 要刷新的文件，默认刷新本次上传的所有文件
 * }
 */

let config = new qiniu.conf.Config();
qiniu.conf.RPC_TIMEOUT = 600000;

function findFiles() {

}

module.exports = class QiniuPlugin {
    constructor(options) {
        if (!options.accessKey || !options.secretKey || !options.zone) {
            throw new Error('accessKey、secretKey and zone is required');
        }
        config.zone = qiniu.zone[options.zone];
        this.options = {
            ...options
        };
    }

    apply(compiler) {
        const {
            accessKey,
            secretKey,
            bucket,
            excludes = [],
            refreshFilter = [],
            cache = false,
            chunkSize = 32,
        } = this.options;
        compiler.plugin("after-emit", (compilation, callback) => {
            console.log(compilation);
            const {
                assets
            } = compilation;
            let fileNames = Reflect.ownKeys(assets);
            fileNames = fileNames.filter(fileName => {
                const file = assets[fileName] || {};
                if (!file.emitted) {
                    return false;
                }
                if (excludes.some(ex => new RegExp(ex).test(fileName))) {
                    return false;
                }
                return true
            })

            const refreshFilterFunc = !_isFunction(refreshFilter) ? (name) => {
                return refreshFilter.some(rf => new RegExp(rf).test(name));
            } : refreshFilter;

            let total = fileNames.length,
                uploaded = 0;

            const getMac = () => new qiniu.auth.digest.Mac(accessKey, secretKey);

            //构建上传策略函数
            const getUptoken = (key) => {
                let options = {
                    scope: bucket + ":" + key,
                };
                let putPolicy = new qiniu.rs.PutPolicy(options);
                return putPolicy.uploadToken(getMac());
            };

            //构造上传函数
            const uploadFile = (localFile) => {
                const file = assets[localFile] || {}
                let formUploader = new qiniu.form_up.FormUploader(config);
                let putExtra = new qiniu.form_up.PutExtra();
                let uptoken = getUptoken(localFile)
                return new Promise((resolve, reject) => {
                    formUploader.putFile(uptoken, localFile, file.existsAt, putExtra, function (
                        err,
                        respBody,
                        respInfo,
                    ) {
                        if (err) {
                            reject(err);
                        } else if (respInfo.statusCode == 200) {

                            uploaded++;
                            resolve()
                        } else {
                            reject(respBody);
                        }
                    });
                })
            };

            // 根据cache计算出需要上传的文件

            const copyFileNames = [...fileNames];
            const uploadChunk = (err) =>{
                let filesNames = copyFileNames.splice(0, chunkSize);
                if (err) {
                    return Promise.reject(err)
                }
                if (filesNames.length> 0) {
                    return Promise.all(fileNames.map(fileName => uploadFile(fileName)))
                    .then(() => uploadChunk())
                    .catch(uploadChunk);
                } else {
                    return Promise.resolve();
                }
            }
            // 开始上传
            uploadChunk()
            .then(() => {
                // 删除文件
                return deleteFiles(getMac(), bucket, fileNames);
            })
            .then(() => {
                //刷新文件
                return refreshCDN(refreshFilterFunc(fileNames), getMac());
            })
            .finally(() => {
                callback();
            })
        })
    }
}

function deleteFiles(mac, bucket, files=[]) {
    let bucketManager = new qiniu.rs.BucketManager(mac, config);
    let deleteOperations = [];
    if (files.length !== 0) {
        //每个operations的数量不可以超过1000个，如果总数量超过1000，需要分批发送
        files.forEach(key => {
            deleteOperations.push(qiniu.rs.deleteOp(bucket, key));
        });
        console.log("deleting %s files on CDN", files.length);
        bucketManager.batch(deleteOperations, function (err, respBody, respInfo) {
            if (err) {
                console.error(err);
            } else {
                // 200 is success, 298 is part success
                if (parseInt(respInfo.statusCode / 100) == 2) {
                    respBody.forEach(function (item) {
                        if (item.code !== 200) {
                            // allFileIsSuccess = false;
                            console.error(item);
                        }
                    });
                } else {
                    console.log(respInfo.deleteusCode);
                    console.log(respBody);
                }
            }
        });
    } else {
        console.log("there is not have extra file need to delete");
    }
}

//处理上传失败的文件
let dealFailedFiles = () => {
    let failObj = JSON.parse(fs.readFileSync(failedUploadLog, fileEncodeType));
    needUpload = Object.keys(failObj.uploadFiles);
    qndataLog = qndata;
    needUpload.forEach(item => {
        qndataLog[item] = new moment().format("YYYY-MM-DD HH:mm:ss");
    });
    qndata = {};
    needUpload = needUpload.map(it => originPath + "/" + it);
    uploadFilesByArr(needUpload);
    refreshCDN(_difference(failObj.refreshArr, needUpload));
};
//全部文件上传完成后根据日志对七牛云上的数据做处理 删除 --> 刷新
let dealFileQN = () => {
    allUploadIsSuccess && console.log("all file is upload successful");
    let bucketManager = new qiniu.rs.BucketManager(mac, config);
    let qndataKeys = Object.keys(qndata);
    let qndataKeysLength = qndataKeys.length;
    let deleteOperations = [];
    if (qndataKeysLength !== 0) {
        //每个operations的数量不可以超过1000个，如果总数量超过1000，需要分批发送
        qndataKeys.forEach(key => {
            deleteOperations.push(qiniu.rs.deleteOp(bucket, key));
        });
        console.log("deleting %s files on CDN", qndataKeys.length);
        bucketManager.batch(deleteOperations, function (err, respBody, respInfo) {
            // console.log(respBody)
            if (err) {
                debugFlag && console.error(err);
                //throw err;
            } else {
                // 200 is success, 298 is part success
                if (parseInt(respInfo.statusCode / 100) == 2) {
                    respBody.forEach(function (item) {
                        if (item.code !== 200) {
                            allFileIsSuccess = false;
                            console.error(item);
                        }
                    });
                    if (allFileIsSuccess) {
                        console.log("all extra file is deleted form qiniuCloud successful");
                    } else {
                        debugFlag && console.error("some deleted is failed");
                    }
                } else {
                    debugFlag && console.log(respInfo.deleteusCode);
                    debugFlag && console.log(respBody);
                }
            }
            // writeQnlog()
            // refreshCDN(needUpload);
        });
        // deleteKeys(qndataKeys)
    } else {
        console.log("there is not have extra file need to delete");
        if (initFirst) {
            // writeQnlog();
        } else {
            // refreshCDN(needUpload);
        }
    }
};
let writeQnlog = () => {
    if (!allUploadIsSuccess || !allRefreshIsSuccess) {
        for (let key in failedObj.uploadFiles) {
            delete qndataLog[key];
        }
        fs.writeFile(failedUploadLog, JSON.stringify(failedObj), "utf8", err => {
            if (err) {
                debugFlag && console.error(err);
            } else {
                console.log(
                    "失败日志已写入" +
                    failedUploadLog +
                    "，请运行 npm run upload2qiniu " +
                    argvArr[0] +
                    " failed 重新" +
                    (allUploadIsSuccess ? "" : "上传") +
                    (allRefreshIsSuccess ? "" : "刷新"),
                );
            }
        });
    }
    fs.writeFile(qndataFile, JSON.stringify(qndataLog), "utf8", err => {
        if (err) {
            console.log("write qiniu.json is failed");
            debugFlag && console.error(err);
        } else {
            console.log("write qiniu.json is success");
        }
    });
};
//刷新cdn缓存，否则需要很久才生效，但限额500/天，坑爹。。
let refreshCDN = (needRefreshArr, mac) => {
    console.log("refreshing CDN...");
    let cdnManager = new qiniu.cdn.CdnManager(mac);
    //刷新链接，单次请求链接不可以超过100个，如果超过，请分批发送请求
    needRefreshArr = _array.chunk(needRefreshArr, 100);

    needRefreshArr.forEach((item, index) => {
        item = cdnManager.refreshUrls(item, function (err, respBody, respInfo) {
            if (err) {
                console.log("刷新cdn出错...");
                // allRefreshIsSuccess = false;
                // let reg = new RegExp(`^(http:|https:)` + cdn);
                // failedObj.refreshArr = failedObj.refreshArr.concat(
                //     item.map(it => it.replace(reg, "")),
                // );
                // debugFlag &&
                console.error(err);
            }
            if (respInfo.statusCode == 200) {
                let jsonBody = JSON.parse(respBody);
                console.log(jsonBody);
                console.log(item);
                console.log("refreshing success");
            }
            if (index === needRefreshArr.length - 1) {
                // writeQnlog();
            }
        });
    });
};
//给定文件地址，判断跟旧文件是否相同
let compareFile = path => {
    let oldPath = path.replace(originPath, oldOriginPath);
    let newHash = "",
        oldHash = "";
    let newHashHandle, oldHashHandle, newRS, oldRS;
    if (initFirst) {
        //如果是第一次运行该程序，则所有文件都需要上传
        _compareFile(path, 1, 2);
    } else {
        try {
            fs.statSync(oldPath);
            newHashHandle = crypto.createHash("md5");
            oldHashHandle = crypto.createHash("md5");
            newRS = fs.createReadStream(__dirname + "/" + path);
            oldRS = fs.createReadStream(__dirname + "/" + oldPath);
            newRS.on("data", newHashHandle.update.bind(newHashHandle));
            newRS.on("end", function () {
                newHash = newHashHandle.digest("hex");
                _compareFile(path, newHash, oldHash);
            });
            oldRS.on("data", oldHashHandle.update.bind(oldHashHandle));
            oldRS.on("end", function () {
                oldHash = oldHashHandle.digest("hex");
                _compareFile(path, newHash, oldHash);
            });
        } catch (err) {
            if (err && err.code == "ENOENT") {
                //如果旧文件中没有对应文件，则该文件需要上传
                _compareFile(path, 1, 2);
            }
        }
    }
};
let _compareFile = (key, newHash, oldHash) => {
    if (newHash !== "" && oldHash !== "") {
        compareFileCount++;
        if (newHash !== oldHash) {
            needUpload.push(key);
        }
        if (compareFileCount === fileCount) {
            console.log("Uploading %s files...", needUpload.length);
            uploadFilesByArr(needUpload);
        }
    }
};
let uploadFilesByArr = arr => {
    arr.forEach(path => {
        //要上传文件的本地路径
        let filePath = path;
        //上传到七牛后保存的文件名
        let key = path.replace(`${originPath}/`, "");

        //生成上传 Token
        let token = uptoken(bucket, key);

        console.log(filePath);
        //调用uploadFile上传
        uploadFile(token, key, filePath);
    });
};

let readFilesFormDir = dir => {
    return statPromise(dir).then(stats => {
        let ret;
        if (stats.isDirectory()) {
            ret = !/[/]php$/.test(dir) &&
                readdirPromise(dir)
                .then(files => {
                    return Promise.all(
                        files.map(file => readFilesFormDir(dir + "/" + file)),
                    );
                })
                .then(paths => {
                    return [].concat(...paths);
                });
            ret = ret || [];
        } else if (stats.isFile()) {
            ret = dir;
        }
        return ret;
    });
};

// 检查url是否带有htpp或https前缀
const urlReg = /^(http:|https:)\/\/\s*/;
const checkUrl = function (url) {
    return urlReg.test(url);
};

// if (argvArr.length === 1 || (argvArr.length === 2 && argvArr[1] === "debug")) {
//     argvArr.length === 2 && argvArr[1] === "debug" && (debugFlag = true);
//     readFilesFormDir(originPath).then(paths => {
//         fileCount = paths.length;
//         console.log("comparing %s files...", fileCount);
//         paths.forEach(path => {
//             let key = path.match(new RegExp("^" + originPath + "[/](.*)$"))[1];
//             if (qndata[key]) {
//                 delete qndata[key];
//             }
//             qndataLog[key] = new moment().format("YYYY-MM-DD HH:mm:ss");
//             compareFile(path);
//         });
//     });
//     //改变index.html中的文件引用
//     fs.readFile(originPath + "/" + originFile, fileEncodeType, (err, data) => {
//         if (err) throw err;
//         data = data.replace(
//             /((href=['"])|(src=['"]))(?!http:)(?!https:)[/]?([^/])/g,
//             "$1" + cdn + "$4",
//         );
//         // console.log(data);
//         fs.writeFile(originPath + "/" + originFile, data, err => {
//             if (err) throw err;
//             console.log("index.html is change success");
//         });
//     });
// } else if (argvArr[1] === "failed") {
//     debugFlag = true;
//     dealFailedFiles();
// } else {
//     console.log("命令行参数不合法");
// }