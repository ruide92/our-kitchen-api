const jwt = require('jsonwebtoken');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function createTokens(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw new Error('Invalid JWT_SECRET');
  return {
    sign(userId) {
      if (!UUID.test(userId)) throw new Error('Invalid user id');
      return jwt.sign({}, secret, { subject: userId, algorithm: 'HS256', issuer: 'kitchen-v1', audience: 'kitchen-mini', expiresIn: '1h' });
    },
    verify(token) {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'kitchen-v1', audience: 'kitchen-mini' });
      if (typeof payload !== 'object' || !UUID.test(payload.sub)) throw new Error('Invalid token subject');
      return payload.sub;
    }
  };
}
module.exports = { createTokens, UUID };
