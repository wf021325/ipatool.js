import plist from 'plist';
import getMAC from 'getmac';
import axios from 'axios';
import {wrapper} from 'axios-cookiejar-support';
import {AxiosError} from 'axios';
import {CookieJar} from 'tough-cookie';

class ApiError extends Error {
    constructor(message, failureType, customerMessage) {
        super(message);
        this.name = 'ApiError';
        this.failureType = failureType;
        this.customerMessage = customerMessage;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ApiError);
        }
    }
}

const _endpoints = {
    login: {
        url: (guid) => `https://auth.itunes.apple.com/auth/v1/native/fast?guid=${guid}`,
        buildBody: ({email, password, mfa}) => ({
            appleId: email,
            attempt: 1,
            createSession: 'true',
            password: `${password}${mfa ?? ''}`,
            rmp: 0,
            why: 'signIn'
        })
    },
    AppInfo: {
        url: (guid) => `https://p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/volumeStoreDownloadProduct?guid=${guid}`,
        buildBody: ({appIdentifier, appVerId}) => ({
            creditDisplay: '',
            salableAdamId: appIdentifier,
            ...(appVerId && {externalVersionId: appVerId})
        })
    },
    purchase: {
        url: () => `https://buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/buyProduct`,
        buildBody: ({appid, appVerId}) => ({
            appExtVrsId: appVerId || '0',
            buyWithoutAuthorization: 'true',
            hasAskedToFulfillPreorder: 'true',
            hasDoneAgeCheck: 'true',
            price: '0',
            pricingParameters: "STDQ",
            productType: 'C',
            salableAdamId: appid
        })
    }
};

class Store {
    static _apiClient;

    static {
        const cookieJar = new CookieJar(undefined, {loose: true});
        const client = axios.create({
            jar: cookieJar,
            headers: {
                'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 30000,
            validateStatus: (status) => status >= 200 && status < 300,
        });

        client.interceptors.request.use(config => {
            if (config.authContext && config.authContext.authHeaders) {
                config.headers = {...config.headers, ...config.authContext.authHeaders};
            }
            return config;
        });

        this._apiClient = wrapper(client);
    }

    static get guid() {
        return getMAC().replace(/:/g, '').toUpperCase();
    }

    static #formatApiError(prefix, error) {
        const details = [];
        if (error.failureType) details.push(`代码: ${error.failureType}`);
        if (error.customerMessage) details.push(`信息: "${error.customerMessage}"`);
        return new Error(`${prefix}[X] [${error.message}] (${details.join(', ')})`);
    }

    static async #request(prefix, handler) {
        try {
            return await handler();
        } catch (error) {
            let finalMessage;
            if (error instanceof ApiError) {
                throw this.#formatApiError(prefix, error);
            } else if (error instanceof AxiosError) {
                const message = error.response ? `HTTP ${error.response.status}` : error.message;
                finalMessage = `${prefix}[X] [网络请求失败] (${message})`;
            } else {
                finalMessage = `${prefix}[X] [未知错误] ${error.message}`;
            }
            throw new Error(finalMessage);
        }
    }

    static async login(email, password, mfa) {
        return this.#request('登录账号：', async () => {
            const endpoint = _endpoints.login;
            const body = plist.build({...endpoint.buildBody({email, password, mfa}), guid: this.guid});
            const resp = await this._apiClient.post(endpoint.url(this.guid), body);
            const parsedResp = plist.parse(resp.data);
            if (!parsedResp.hasOwnProperty('status')) {
                throw new ApiError('登录认证失败', parsedResp.failureType, parsedResp.customerMessage);
            }
            const dsid = parsedResp.dsPersonId;
            const passwordToken = parsedResp.passwordToken;
            const storeFrontHeader = resp.headers['x-set-apple-store-front']?.split('-')[0];
            parsedResp.authHeaders = {
                'X-Dsid': dsid,
                'iCloud-DSID': dsid,
                'X-Token': passwordToken,
            };
            if (storeFrontHeader) {
                parsedResp.authHeaders['X-Apple-Store-Front'] = storeFrontHeader;
            }
            return parsedResp;
        });
    }

    static async AppInfo(appIdentifier, appVerId, authContext) {
        return this.#request('下载软件：', async () => {
            const endpoint = _endpoints.AppInfo;
            const body = plist.build({...endpoint.buildBody({appIdentifier, appVerId}), guid: this.guid});
            const resp = await this._apiClient.post(endpoint.url(this.guid), body, {authContext});
            const parsedResp = plist.parse(resp.data);
            if (parsedResp.failureType === '5002') {
                throw new ApiError('获取App信息失败', parsedResp.failureType, '服务器繁忙请重试');
            }
            if (parsedResp.customerMessage) {
                const message = parsedResp.customerMessage;
                throw new ApiError('获取App信息失败', parsedResp.failureType, message);
            }
            if (!parsedResp.songList?.[0]) {
                const msg = '查询成功，但没有数据';
                throw new ApiError('获取App信息失败', '', msg);
            }
            return parsedResp;
        });
    }

    static async purchase(appid, appVerId, authContext) {
        return this.#request('购买软件：', async () => {
            const endpoint = _endpoints.purchase;
            const body = plist.build({...endpoint.buildBody({appid, appVerId}), guid: this.guid});
            const resp = await this._apiClient.post(endpoint.url(), body, {authContext});
            const parsedResp = plist.parse(resp.data);

            if (parsedResp.status === 0 || parsedResp.failureType === '5002' || parsedResp.failureType === '2040') {
                let message = '获取许可成功';
                if (parsedResp.failureType === '5002' || parsedResp.failureType === '2040') {
                    message = '应用已在资料库中';
                } else if (parsedResp.status === 0) {
                    message = '成功获取新许可';
                }
                return {...parsedResp, _state: 'success', customerMessage: message};
            }

            throw new ApiError('获取许可失败', parsedResp.failureType, parsedResp.customerMessage);
        });
    };
}

export {Store};