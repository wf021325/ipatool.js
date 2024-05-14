import {IPATool} from './src/ipa.js';
const ipaTool = new IPATool();

//如果下载完成未报错即为成功，否则请重新下载

await ipaTool.downipa({
    // 你想要保存文件的路径,留空为当前目录，比如当前目录下app目录【./app】
    path: './app',

    // 微信：414478124//你想要下载的应用程序的ID
    APPID: '1215494034',

    //微信8.0.48:864225682 //版本id,下载旧版本需要填写,留空默认下新版本
    appVerId: '',

    // 你的 Apple ID 邮箱
    APPLE_ID: 'aoole@gmail.com',

    // 你的 Apple ID 密码
    PASSWORD: 'Aa112233',

    //两步验证代码，如果操作登录，手机弹出两步验证码，则填写到此处，第二次使用前请删除这里
    CODE: ''

});

