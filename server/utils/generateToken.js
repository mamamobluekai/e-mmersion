const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const { testLoginEnabled } = require('../config/testLogin')
const { ACCESS_TTL_MS, REFRESH_TTL_MS } = require('../config/sessionPolicy')
const testKeyId = 'local-test-login'
const testSigningKey = crypto.randomBytes(32)

// Every token now carries a unique `jti`. Access-token jti values are used by
// the deny-list in utils/tokenStore.js so a logged-out token can be revoked
// before its natural expiry; refresh-token jti values are the rotation key.
const newJti = () => crypto.randomUUID()

// Pin the algorithm explicitly. Without this, verification would accept any
// algorithm the token header claims, which is the classic `alg: none` /
// algorithm-confusion weakness (CWE-347).
const SIGN_OPTIONS = { algorithm: 'HS256' }

function assertSecret() {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is not configured. Refusing to sign or verify tokens.');
    }
}

function sign(payload, expiresIn, testSession) {
    assertSecret()
    const options = { ...SIGN_OPTIONS, expiresIn }
    if (testSession) {
        if (!testLoginEnabled()) throw new Error('Local test sign-in is disabled.')
        return jwt.sign(payload, testSigningKey, { ...options, keyid: testKeyId })
    }
    return jwt.sign(payload, process.env.JWT_SECRET, options)
}

const generateAccessToken = (user, testSession = false) =>  {
    return sign(
    {
        id: user.id,
        email: user.email,
        role: user.role,
        jti: user.jti || newJti(),
        type: 'access',
        ...(user.sid ? { sid: user.sid } : {}),

    },
    ACCESS_TTL_MS / 1000,
    testSession
    )

}

const generateRefreshToken = (user, testSession = false, expiresIn = REFRESH_TTL_MS / 1000) => {
    const jti = user.jti || newJti()
    const token = sign(
        {id: user.id, jti, type: 'refresh'},
        expiresIn,
        testSession
    )
    // Return the token plus its jti so callers can persist the rotation record.
    return { token, jti }
}
function verify(token, maxAge) {
    assertSecret()
    const isTestToken = jwt.decode(token, { complete: true })?.header?.kid === testKeyId
    if (isTestToken && !testLoginEnabled()) throw new Error('Local test sign-in is disabled.')
    // Pinning `algorithms` rejects `alg: none` and algorithm-confusion forgeries.
    return jwt.verify(token, isTestToken ? testSigningKey : process.env.JWT_SECRET, { algorithms: ['HS256'], maxAge })
}

const verifyAccessToken = (token) => verify(token, ACCESS_TTL_MS / 1000)
const verifyRefreshToken = (token) => verify(token, REFRESH_TTL_MS / 1000)
module.exports = {generateAccessToken, generateRefreshToken, verifyAccessToken, verifyRefreshToken};
