const { apiRequest } = require('./api');

// 平台全局功能开关（总后台「平台管理 → 功能开关」）。
// 权威来源是服务端；本地只保存只读副本用于隐藏入口，读取失败时不隐藏（服务端 403 仍是最终拦截）。
const STORAGE_KEY = 'ruda_module_flags';
const FASHION_KEY = 'fashion_enabled';
const MODAUI_KEY = 'modaui_enabled';
const REFRESH_THROTTLE_MS = 3000;

let inflight = null;
let lastAttemptAt = 0;

function readCache() {
  if (typeof wx === 'undefined') return null;
  try {
    const cached = wx.getStorageSync(STORAGE_KEY);
    if (!cached || typeof cached !== 'object') return null;
    const flags = cached.flags && typeof cached.flags === 'object' ? cached.flags : {};
    return flags;
  } catch (error) {
    return null;
  }
}

function readFlag(key) {
  const flags = readCache();
  if (flags && typeof flags[key] === 'boolean') return flags[key];
  return true;
}

function isFashionEnabled() {
  return readFlag(FASHION_KEY);
}

function isModauiEnabled() {
  return readFlag(MODAUI_KEY);
}

function refreshModuleFlags(options) {
  const settings = options || {};
  const force = settings.force === true;
  if (inflight) return inflight;
  if (!force && Date.now() - lastAttemptAt < REFRESH_THROTTLE_MS && readCache()) {
    return Promise.resolve(readCache());
  }
  lastAttemptAt = Date.now();
  inflight = apiRequest('/api/public/feature-flags', { auth: false })
    .then(function (response) {
      const flags = response && response.flags && typeof response.flags === 'object' ? response.flags : {};
      if (typeof wx !== 'undefined') {
        try {
          wx.setStorageSync(STORAGE_KEY, { flags: flags, fetchedAt: Date.now() });
        } catch (error) {
          // 本地缓存失败不影响服务端判断。
        }
      }
      return flags;
    })
    .catch(function () {
      const flags = readCache();
      return flags || {};
    })
    .then(function (flags) {
      inflight = null;
      return flags;
    });
  return inflight;
}

module.exports = {
  FASHION_KEY,
  MODAUI_KEY,
  isFashionEnabled,
  isModauiEnabled,
  refreshModuleFlags
};
