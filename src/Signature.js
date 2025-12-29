import { promises as fsPromises, createReadStream, createWriteStream } from 'fs';
import {finished} from 'stream/promises';
import { createHash } from 'crypto';
import StreamZip from 'node-stream-zip';
import archiver from 'archiver';
import plist from 'plist';

export class SignatureClient {
    constructor(songInfo, email) {
        this.expectedMd5 = songInfo?.md5;
        this.metadata = {...songInfo.metadata, 'apple-id': email, userName: email, 'appleId': email, 'com.apple.iTunesStore.downloadInfo': {'accountInfo': {'AppleID': email}}};
        this.signature = songInfo?.sinfs[0]?.sinf;
        if (!this.signature) {
            const e = new Error('软件签名：[X] 初始化失败: 无效的签名数据 (Invalid signature data.)');
            e.prefix = '软件签名：';
            throw e;
        }
    }

    async calculateMD5(filePath) {
        return new Promise((resolve, reject) => {
            try {
                const hash = createHash('md5');
                const stream = createReadStream(filePath);
                stream.on('data', data => hash.update(data));
                stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
                stream.on('error', err => {
                    console.error('MD5 计算读取失败:', err);
                    reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    async sign(ipaPath) {
        if (this.expectedMd5) {
            console.log(`文件校验：正在校验 MD5 (文件较大，请稍候...)...`);
            const currentMd5 = await this.calculateMD5(ipaPath);
            if (currentMd5 !== this.expectedMd5.toLowerCase()) {
                const e = new Error(`文件校验：[X] MD5 校验失败！预期: ${this.expectedMd5}, 实际: ${currentMd5}`);
                e.prefix = '文件校验：';
                throw e;
            }
            console.log('文件校验：[OK] 原始文件 MD5 校验通过');
        }

        console.log('软件签名：... 正在处理 IPA 文件...');
        const tempIpaPath = ipaPath + '.tmp';
        let readZip;
        let success = false;
        try {
            readZip = new StreamZip.async({file: ipaPath});
            const output = createWriteStream(tempIpaPath);
            const archive = archiver('zip', {zlib: {level: 1}});
            archive.pipe(output);
            const entries = await readZip.entries();
            const mainAppSuppRegex = /^Payload\/[^\/]+\.app\/SC_Info\/[^\/]+\.supp$/i;
            const candidates = Object.values(entries).filter(entry => mainAppSuppRegex.test(entry.name));
            if (candidates.length === 0) {
                const e = new Error('软件签名：[X] 无效的 App 包: 未找到主程序的 SC_Info/*.supp 签名占位文件');
                e.prefix = '软件签名：';
                throw e;
            }
            const suppFileEntry = candidates.sort((a, b) => a.name.length - b.name.length)[0];
            const signatureTargetPath = suppFileEntry.name.replace(/\.supp$/i, '.sinf');
            archive.append(Buffer.from(plist.build(this.metadata), 'utf8'), {name: 'iTunesMetadata.plist'});
            archive.append(Buffer.from(this.signature, 'base64'), {name: signatureTargetPath});
            for (const entry of Object.values(entries)) {
                if (entry.isDirectory || entry.name === 'iTunesMetadata.plist' || entry.name === signatureTargetPath) continue;
                const stream = await readZip.stream(entry.name);
                archive.append(stream, {name: entry.name});
            }
            await archive.finalize();
            await finished(output);
            success = true;
        } catch (error) {
            if (error && error.prefix) throw error;
            const e = new Error(`软件签名：[X] 文件签名失败: ${error.message}`);
            e.prefix = '软件签名：';
            throw e;
        } finally {
            if (readZip) await readZip.close().catch(() => {
            });
            if (!success) await fsPromises.unlink(tempIpaPath).catch(() => {
            });
        }
        await fsPromises.rename(tempIpaPath, ipaPath);
        console.log('软件签名：[OK] 文件签名成功！');
    }
}