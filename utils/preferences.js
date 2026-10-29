const { getAuthSession } = require('./auth');
const { getAccountPreferences, saveAccountPreferences, getExchangeRates } = require('./api');

const PREFERENCES_KEY = 'ruda_account_preferences';
const EXCHANGE_RATES_KEY = 'ruda_exchange_rates';
const LANGUAGES = [
  { code: 'auto', label: '自动' }, { code: 'en', label: 'English' }, { code: 'it', label: 'Italiano' },
  { code: 'zh', label: '简体中文' }, { code: 'fr', label: 'Français' }, { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' }, { code: 'pt', label: 'Português' }, { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' }, { code: 'ro', label: 'Română' }, { code: 'tr', label: 'Türkçe' },
  { code: 'ar', label: 'العربية' }
];
const CURRENCIES = ['EUR', 'USD', 'CNY', 'GBP', 'JPY', 'CHF'];
const DEFAULT_PREFERENCES = { language: 'auto', currency: 'EUR', monochrome: false };

function normalizePreferences(value) {
  const source = value && typeof value === 'object' ? value : {};
  const languageCodes = LANGUAGES.map(item => item.code);
  return {
    language: languageCodes.includes(source.language) ? source.language : DEFAULT_PREFERENCES.language,
    currency: CURRENCIES.includes(source.currency) ? source.currency : DEFAULT_PREFERENCES.currency,
    monochrome: typeof source.monochrome === 'boolean' ? source.monochrome : DEFAULT_PREFERENCES.monochrome
  };
}

function getPreferences() {
  return normalizePreferences(wx.getStorageSync(PREFERENCES_KEY));
}

function saveLocalPreferences(patch) {
  const preferences = normalizePreferences(Object.assign({}, getPreferences(), patch));
  wx.setStorageSync(PREFERENCES_KEY, preferences);
  return preferences;
}

function getPreferenceIdentity() {
  const session = getAuthSession();
  if (!session) return null;
  if (session.role === 'buyer' && session.profile && session.profile.id) {
    return { role: 'buyer', accountId: session.profile.id };
  }
  if ((session.role === 'merchant' || session.role === 'employee') && session.merchant && session.merchant.id) {
    return { role: 'merchant', accountId: session.merchant.id };
  }
  return null;
}

async function loadPreferencesFromAccount() {
  const identity = getPreferenceIdentity();
  if (!identity) return null;
  const result = await getAccountPreferences(identity.role, identity.accountId);
  return { preferences: normalizePreferences(result.preferences), hasSavedPreferences: result.hasSavedPreferences === true };
}

async function savePreferences(patch) {
  const preferences = saveLocalPreferences(patch);
  const identity = getPreferenceIdentity();
  if (!identity) return { preferences, synced: false };
  const result = await saveAccountPreferences(identity.role, identity.accountId, patch);
  const saved = normalizePreferences(result.preferences);
  wx.setStorageSync(PREFERENCES_KEY, saved);
  return { preferences: saved, synced: true };
}

async function loadExchangeRates() {
  const result = await getExchangeRates();
  if (!result.rates || typeof result.rates.EUR !== 'number') throw new Error('EXCHANGE_RATES_INVALID_RESPONSE');
  wx.setStorageSync(EXCHANGE_RATES_KEY, result);
  return result;
}

function formatEurAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  const preferences = getPreferences();
  const currency = preferences.currency;
  const rates = wx.getStorageSync(EXCHANGE_RATES_KEY);
  const rate = currency === 'EUR' ? 1 : rates && rates.rates && rates.rates[currency];
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return '';
  const symbols = { EUR: '€', USD: '$', CNY: '¥', GBP: '£', JPY: '¥', CHF: 'CHF ' };
  return symbols[currency] + (amount * rate).toFixed(2);
}

module.exports = {
  LANGUAGES,
  CURRENCIES,
  getPreferences,
  saveLocalPreferences,
  getPreferenceIdentity,
  loadPreferencesFromAccount,
  savePreferences,
  loadExchangeRates,
  formatEurAmount
};
