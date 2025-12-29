import {promises as fsPromises, createWriteStream, createReadStream} from 'fs';
import path from 'path';
import axios from 'axios';
import PQueue from 'p-queue';

const CHUNK = 5 * 1024 * 1024;
const CONC = 10;
const RETRIES = 3;
const RETRY_DELAY = 1000;
const TIMEOUT = 60000;

function sanitize(prefix, rawError, meta = {}) { const err = rawError instanceof Error ? rawError : new Error(String(rawError));
    const parts = [];
    if (meta.start !== undefined) parts.push(`start=${meta.start}`);
    if (meta.end !== undefined) parts.push(`end=${meta.end}`);
    if (meta.attempts !== undefined) parts.push(`attempts=${meta.attempts}`);
    const metaStr = parts.length ? ` (${parts.join(' ')})` : '';
    const message = `${prefix}[X] [${err.message}]${metaStr}`;
    const e = new Error(message);
    e.prefix = prefix;
    e.meta = meta;
    return e;
}

class Progress {
    constructor(total) {
        this.total = total;
        this.done = 0;
        this.lastT = 0;
        this.lastB = 0;
        this.interval = null;
        this.startTime = Date.now();
    }

    report() {
        const now = Date.now();
        if (now - this.lastT < 500 && this.done < this.total) return;
        const instant_dt = (now - this.lastT) / 1000;
        const instant_db = this.done - this.lastB;
        const instant_speed = instant_dt > 0 ? instant_db / instant_dt / 1024 / 1024 : 0;
        const total_dt = (now - this.startTime) / 1000;
        const average_speed = total_dt > 0 ? this.done / total_dt / 1024 / 1024 : 0;
        const pct = (this.done / this.total * 100).toFixed(2);
        const dMB = (this.done / 1024 / 1024).toFixed(2);
        const tMB = (this.total / 1024 / 1024).toFixed(2);
        const displaySpeed = (total_dt < 2 ? instant_speed : average_speed).toFixed(2);
        process.stdout.write(`下载进度: ${dMB}MB / ${tMB}MB (${pct}%) - 速度: ${displaySpeed} MB/s\r`);
        this.lastT = now;
        this.lastB = this.done;
    }

    createChunkUpdater() {
        return (bytes) => {
            this.done += bytes;
        };
    }

    start() {
        this.interval = setInterval(() => this.report(), 500);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.report();
            process.stdout.write('\n');
        }
    }
}

async function downloadChunkToFile({client, url, start, end, partPath, temp = '.tmp', timeout = TIMEOUT, retries = RETRIES, delay = RETRY_DELAY, headers = {}, onProgress}) { const tmp = partPath + temp;
    await fsPromises.unlink(tmp).catch(err => { if (err.code !== 'ENOENT') throw err; });
    let at = 0;
    while (at < retries) {
        at++;
        try {
            const r = await client.get(url, {
                headers: {Range: `bytes=${start}-${end}`, ...headers},
                responseType: 'stream',
                timeout
            });
            if (![200, 206].includes(r.status)) throw sanitize('下载分块：', new Error(`HTTP ${r.status}`), {start, end, attempts: at});
            await new Promise((resolve, reject) => {
                const s = r.data;
                const w = createWriteStream(tmp);
                if (typeof onProgress === 'function') s.on('data', (c) => onProgress(c.length));
                s.pipe(w);
                s.on('error', reject);
                w.on('error', reject);
                w.on('finish', resolve);
            });
            await fsPromises.rename(tmp, partPath);
            return;
        } catch (err) {
            await fsPromises.unlink(tmp).catch(() => {});
            if (at >= retries) throw sanitize('下载分块：', err, {start, end, attempts: at});
            await new Promise(r => setTimeout(r, delay * at));
        }
    }
}

async function mergeParts({out, dir, parts}) {
    const w = createWriteStream(out);
    // 当分块数量巨大时，循环中的 pipe 会触发监听器警告。
    // 在此临时提高限制，以避免在合并大量分块时出现误报。
    const originalMaxListeners = w.getMaxListeners();
    if (parts > originalMaxListeners) w.setMaxListeners(parts + 1);

    try {
        for (let i = 0; i < parts; i++) {
            const partPath = path.join(dir, `part_${i}`);
            const r = createReadStream(partPath);
            await new Promise((resolve, reject) => {
                const onError = (err) => { w.destroy(err); reject(err); };
                r.on('error', onError); w.on('error', onError);
                r.on('end', resolve);
                r.pipe(w, {end: false});
            });
        }
    } finally {
        if (parts > originalMaxListeners) w.setMaxListeners(originalMaxListeners); // 恢复原始限制
        w.end();
    }
}

async function download(url, out, dir, auth = {}, opts = {}) { const chunk = opts.chunkSize || CHUNK;
    const conc = opts.concurrency || CONC;
    const retries = opts.retries || RETRIES;
    const delay = opts.retryDelayMs || RETRY_DELAY;
    const timeout = opts.timeout || TIMEOUT;
    await fsPromises.mkdir(dir, {recursive: true});
    const client = axios.create({timeout});
    let size;
    try {
        const h = await client.head(url, {headers: {...auth}, timeout}).catch(async () => {
            const r = await client.get(url, {headers: {Range: 'bytes=0-0', ...auth}, timeout});
            return {
                headers: {'content-length': r.headers['content-range']?.split('/')?.[1] || r.headers['content-length']}
            };
        });
        size = Number(h.headers['content-length']);
    } catch (err) {
        throw sanitize('下载开始：', err, {});
    }
    if (!size) throw sanitize('下载开始：', new Error('无法获取文件大小'), {}); const parts = Math.ceil(size / chunk);
    const prog = new Progress(size);
    const q = new PQueue({concurrency: conc});
    const tasks = [];
    for (let i = 0; i < parts; i++) {
        const start = i * chunk;
        const end = Math.min(start + chunk - 1, size - 1);
        const pth = path.join(dir, `part_${i}`);
        const t = q.add(async () => {
            const st = await fsPromises.stat(pth).catch(() => null);
            const chunkSize = end - start + 1;
            if (st && st.size === chunkSize) {
                prog.createChunkUpdater()(chunkSize);
                return;
            }
            await downloadChunkToFile({client, url, start, end, partPath: pth, temp: '.tmp', timeout, retries, delay, headers: auth, onProgress: prog.createChunkUpdater()});
        });
        tasks.push(t);
    }
    prog.start();
    try { await Promise.all(tasks); } finally { prog.stop(); }
    await mergeParts({out, dir, parts});
    return {fileSize: size, parts};
}

export {download};