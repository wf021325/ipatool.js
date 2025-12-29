import 'dotenv/config';
import {Ipa} from './src/ipa.js';

(async () => {
    try {
        const app = new Ipa({
            APPLE_ID: process.env.APPLE_ID,
            PASSWORD: process.env.APPLE_PWD,
            CODE: process.env.APPLE_CODE || '',
        });

        await app.login();
        await app.run({
            dir: process.env.DOWNLOAD_DIR || './app',
            APPID: process.env.DOWNLOAD_APPID,
            appVerId: process.env.DOWNLOAD_VERSION_ID || '',
        });

        console.log('* 任务全部完成！ *');
    } catch (err) {
        console.error(err.message || String(err));
        process.exit(1);
    }
})();