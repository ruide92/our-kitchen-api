const { ApiError } = require('./errors');

function createWechatClient({ appid, secret, fetchImpl = globalThis.fetch }) {
  if (!appid || !secret) throw new Error('WECHAT_APP_ID and WECHAT_APP_SECRET are required');
  return {
    async exchange(code) {
      if (typeof code !== 'string' || !code.trim() || code.length > 512) {
        throw new ApiError(400, 'INVALID_CODE', '缺少有效微信登录凭证');
      }
      const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
      url.search = new URLSearchParams({ appid, secret, js_code: code, grant_type: 'authorization_code' });
      let body;
      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
        if (!response.ok) throw new Error('upstream HTTP failure');
        body = await response.json();
      } catch {
        // Never propagate fetch errors: their message may contain the credential-bearing URL.
        throw new ApiError(503, 'WECHAT_UNAVAILABLE', '微信登录服务暂不可用');
      }
      if (body?.errcode || typeof body?.openid !== 'string' || !body.openid.trim()) {
        throw new ApiError(401, 'INVALID_CODE', '微信登录凭证无效');
      }
      return { openid: body.openid, unionid: typeof body.unionid === 'string' ? body.unionid : null };
    }
  };
}
module.exports = { createWechatClient };
