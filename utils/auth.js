const { AUTH_STORAGE_KEY } = require('./constants');

const supportedRoles = ['buyer', 'merchant', 'employee'];

function getAuthSession() {
  const session = wx.getStorageSync(AUTH_STORAGE_KEY);
  if (!session || typeof session !== 'object'
    || !supportedRoles.includes(session.role)
    || typeof session.token !== 'string'
    || !session.token) {
    return null;
  }
  if (typeof session.expiresAt === 'number' && session.expiresAt <= Date.now()) {
    clearAuthSession();
    return null;
  }
  return session;
}

function saveAuthSession(role, response) {
  if (!supportedRoles.includes(role) || !response || typeof response.token !== 'string' || !response.token) {
    throw new Error('AUTH_RESPONSE_INVALID');
  }
  const profileKey = role === 'employee' ? 'employee' : role;
  const session = {
    role,
    token: response.token,
    expiresAt: Date.now() + Number(response.expiresIn || 0) * 1000,
    profile: response[profileKey] || null,
    merchant: response.merchant || null
  };
  wx.setStorageSync(AUTH_STORAGE_KEY, session);
  return session;
}

function clearAuthSession() {
  wx.removeStorageSync(AUTH_STORAGE_KEY);
}

async function getVerifiedAuthProfile() {
  const session = getAuthSession();
  if (!session) return null;
  const { getAuthProfile } = require('./api');
  try {
    const response = await getAuthProfile(session.role);
    if (!response.success) {
      clearAuthSession();
      return null;
    }
    return { session, response };
  } catch (error) {
    if (error && error.status === 401) return null;
    throw error;
  }
}

module.exports = {
  getAuthSession,
  saveAuthSession,
  clearAuthSession,
  getVerifiedAuthProfile
};
