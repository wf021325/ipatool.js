import {promises as fsPromises} from 'fs';
import path from 'path';
import {Store} from './client.js';
import {SignatureClient} from './Signature.js';
import {download} from './downloader.js';

export class Ipa {
    constructor({APPLE_ID, PASSWORD, CODE}) {
        this.creds = {APPLE_ID, PASSWORD, CODE};
        this.user = null;
        this.auth = {};
        this.dir = '.';
        this.out = '';
        this.cache = '';
    }

    async login() {
        const user = await Store.login(this.creds.APPLE_ID, this.creds.PASSWORD, this.creds.CODE);
        console.log(`登录账号：[OK] [登录成功] ${user.accountInfo.address.firstName} ${user.accountInfo.address.lastName}`);
        this.user = user;
        this.auth = {authHeaders: user.authHeaders};
    }

    async info(APPID, appVerId) {
        const appInfo = await Store.AppInfo(APPID, appVerId, this.auth);
        const s = appInfo?.songList?.[0];
        const name = s?.metadata?.bundleDisplayName || 'UnknownApp';
        const ver = s?.metadata?.bundleShortVersionString || 'UnknownVer';
        console.log(`软件信息：[OK] 名称: ${name}  版本: ${ver}`);
        this.out = path.join(this.dir, `${name}_${ver}.ipa`);
        return s;
    }

    async run({dir = '.', APPID, appVerId} = {}) {
        if (!this.user) throw new Error('Please login() first');
        this.dir = dir;
        this.cache = path.join(this.dir, 'cache');
        await fsPromises.mkdir(this.cache, {recursive: true});
        const purchaseResult = await Store.purchase(APPID, appVerId, this.auth);
        console.log(`购买软件：[OK] ${purchaseResult.customerMessage}`);
        const song = await this.info(APPID, appVerId);
        const res = await download(song.URL, this.out, this.cache, this.auth.authHeaders || {});
        console.log(`下载完成：[OK] 文件大小 ${(res.fileSize / 1024 / 1024).toFixed(2)} MB，分块数量: ${res.parts}`);
        await fsPromises.rm(this.cache, {recursive: true, force: true});
        console.log('清理缓存：[OK] 临时文件已删除。');
        const signer = new SignatureClient(song, this.user.accountInfo.appleId);
        await signer.sign(this.out);

        console.log(`文件存档：[OK] 文件已存至当前目录: ${this.out}`);
    }
}