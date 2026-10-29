const { clearAuthSession, getAuthSession } = require('../../utils/auth');
const { LANGUAGES, CURRENCIES, getPreferences, getPreferenceIdentity, loadPreferencesFromAccount, loadExchangeRates, saveLocalPreferences, savePreferences } = require('../../utils/preferences');
const { activateFashionAccount, getAssetUrl, getFashionAccountMe, updateFashionAccountProfile } = require('../../utils/api');

const roleLabels = { buyer: '买家账号', merchant: '商家账号', employee: '员工账号' };
const MERCHANT_MINIPROGRAM_APP_ID = 'wx18abf078e13f9f0a';

function languageLabel(code) {
  const language = LANGUAGES.find(item => item.code === code);
  return language ? language.label : '自动';
}

Page({
  data: {
    isLoggedIn: false,
    isBuyer: false,
    hasMerchantAccess: false,
    accountTitle: '登录 RUDA 账号',
    accountDescription: '登录后使用你的 RUDA 账户',
    languages: LANGUAGES.map(item => item.label),
    languageIndex: 0,
    languageLabel: '自动',
    currencies: CURRENCIES,
    currencyIndex: 0,
    currencyLabel: 'EUR',
    monochrome: false,
    fashionProfileLoading: false,
    fashionProfileError: '',
    fashionProfile: null,
    fashionPosts: [],
    profileEditorOpen: false,
    profileEditName: '',
    profileEditBio: '',
    profileSaving: false,
    syncStatus: '设置保存在本设备；登录后可同步到 RUDA 账户。',
    prefsError: '',
    prefsNotice: ''
  },

  onShow() {
    this.refreshSession();
    this.refreshPreferences();
  },

  refreshSession() {
    const session = getAuthSession();
    const isLoggedIn = Boolean(session);
    this.setData({
      isLoggedIn,
      isBuyer: Boolean(session && session.role === 'buyer'),
      hasMerchantAccess: Boolean(session && ['merchant', 'employee'].includes(session.role)),
      accountTitle: isLoggedIn ? '账号已登录' : '登录 RUDA 账号',
      accountDescription: isLoggedIn
        ? (roleLabels[session.role] || 'RUDA 账号') + ' · 会话已启用'
        : '登录后使用你的 RUDA 账户'
    });
    if (session && session.role === 'buyer') {
      this.refreshFashionProfile();
    } else {
      this._fashionProfileRequest = (this._fashionProfileRequest || 0) + 1;
      this.setData({ fashionProfileLoading: false, fashionProfileError: '', fashionProfile: null, fashionPosts: [] });
    }
  },

  async refreshFashionProfile() {
    if (this._fashionProfileLoading) return;
    const requestId = (this._fashionProfileRequest || 0) + 1;
    this._fashionProfileRequest = requestId;
    this._fashionProfileLoading = true;
    this.setData({ fashionProfileLoading: true, fashionProfileError: '' });
    try {
      await activateFashionAccount();
      const result = await getFashionAccountMe();
      if (requestId !== this._fashionProfileRequest) return;
      if (!result || !result.account || typeof result.account.id !== 'string') {
        throw new Error('个人创作者资料暂不可用。');
      }
      this.setData({
        fashionProfile: Object.assign({}, result.account, {
          avatarUrl: getAssetUrl(result.account.avatarUrl),
          initial: String(result.account.displayName || 'R')[0],
          stats: result.stats || { posts: 0, saved: 0, following: 0, followers: 0 }
        }),
        fashionPosts: (Array.isArray(result.posts) ? result.posts : []).map(post => Object.assign({}, post, {
          imageUrl: getAssetUrl(post.image),
          statusLabel: post.publicationStatus === 'approved'
            ? '已公开'
            : post.publicationStatus === 'unpublished' ? '未公开' : '审核中'
        })),
        fashionProfileLoading: false
      });
    } catch (error) {
      if (requestId !== this._fashionProfileRequest) return;
      this.setData({
        fashionProfileLoading: false,
        fashionProfileError: error && error.message ? error.message : '个人创作者资料加载失败，请重试。'
      });
    } finally {
      if (requestId === this._fashionProfileRequest) this._fashionProfileLoading = false;
    }
  },

  openFashionProfilePost(event) {
    const postId = String(event.currentTarget.dataset.id || '');
    if (!postId) return;
    if (event.currentTarget.dataset.status !== 'approved') {
      wx.showToast({ title: '该作品尚未公开', icon: 'none' });
      return;
    }
    wx.setStorageSync('ruda_fashion_requested_post_id', postId);
    wx.switchTab({
      url: '/pages/fashion/index',
      fail: () => wx.removeStorageSync('ruda_fashion_requested_post_id')
    });
  },

  openFashionCreatorHub() {
    wx.switchTab({ url: '/pages/fashion/index' });
  },

  openFashionComposer() {
    wx.setStorageSync('ruda_fashion_open_composer', true);
    wx.switchTab({
      url: '/pages/fashion/index',
      fail: () => wx.removeStorageSync('ruda_fashion_open_composer')
    });
  },

  openFashionProfileEditor() {
    const profile = this.data.fashionProfile;
    if (!profile) return;
    this.setData({
      profileEditorOpen: true,
      profileEditName: profile.displayName || '',
      profileEditBio: profile.bio || ''
    });
  },

  closeFashionProfileEditor() {
    if (!this.data.profileSaving) this.setData({ profileEditorOpen: false });
  },

  stopProfileEditorTap() {},

  onProfileEditInput(event) {
    const field = event.currentTarget.dataset.field;
    if (field === 'name') this.setData({ profileEditName: event.detail.value });
    if (field === 'bio') this.setData({ profileEditBio: event.detail.value });
  },

  async saveFashionProfile() {
    if (this.data.profileSaving) return;
    const displayName = String(this.data.profileEditName || '').trim();
    const bio = String(this.data.profileEditBio || '').trim();
    if (!displayName || displayName.length > 80 || bio.length > 300) {
      wx.showToast({ title: '昵称需为 1–80 字，简介不能超过 300 字', icon: 'none' });
      return;
    }
    this.setData({ profileSaving: true });
    try {
      const result = await updateFashionAccountProfile({ displayName, bio });
      if (!result || !result.account || result.account.id !== this.data.fashionProfile.id) {
        throw new Error('服务器没有返回有效的个人资料。');
      }
      this.setData({
        profileEditorOpen: false,
        fashionProfile: Object.assign({}, this.data.fashionProfile, {
          displayName: result.account.displayName,
          bio: result.account.bio || '',
          avatarUrl: getAssetUrl(result.account.avatarUrl),
          initial: String(result.account.displayName || 'R')[0]
        })
      });
      wx.showToast({ title: '个人主页已更新', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error && error.message ? error.message : '保存个人资料失败', icon: 'none' });
    } finally {
      this.setData({ profileSaving: false });
    }
  },

  applyPreferences(preferences) {
    const languageIndex = Math.max(0, LANGUAGES.findIndex(item => item.code === preferences.language));
    const currencyIndex = Math.max(0, CURRENCIES.indexOf(preferences.currency));
    this.setData({
      languageIndex,
      languageLabel: languageLabel(preferences.language),
      currencyIndex,
      currencyLabel: preferences.currency,
      monochrome: preferences.monochrome
    });
  },

  async refreshPreferences() {
    const local = getPreferences();
    this.applyPreferences(local);
    this.setData({ prefsError: '', prefsNotice: '' });
    if (local.currency !== 'EUR') {
      try {
        await loadExchangeRates();
      } catch (error) {
        this.setData({ prefsError: '汇率暂不可用，货币偏好仍已保存在本设备。' });
      }
    }
    if (!getPreferenceIdentity()) {
      this.setData({ syncStatus: '设置保存在本设备；登录后可同步到 RUDA 账户。' });
      return;
    }
    this.setData({ syncStatus: '正在同步账户设置…' });
    try {
      const result = await loadPreferencesFromAccount();
      if (result.hasSavedPreferences) {
        saveLocalPreferences(result.preferences);
        this.applyPreferences(result.preferences);
        if (result.preferences.currency !== 'EUR') await loadExchangeRates();
      } else {
        await savePreferences(local);
      }
      this.setData({ syncStatus: '偏好已同步到 RUDA 账户，可在支持这些设置的 Web 页面使用。', prefsError: '' });
    } catch (error) {
      this.setData({
        syncStatus: '账户设置同步失败。',
        prefsError: error && error.message ? error.message : '请检查网络后重试。'
      });
    }
  },

  async persistPreference(patch) {
    saveLocalPreferences(patch);
    this.setData({ prefsError: '', prefsNotice: '', syncStatus: getPreferenceIdentity() ? '正在保存账户设置…' : '已保存在本设备。' });
    try {
      const result = await savePreferences(patch);
      this.applyPreferences(result.preferences);
      this.setData({ syncStatus: result.synced ? '偏好已同步到 RUDA 账户。' : '已保存在本设备；登录后可同步到 RUDA 账户。' });
      return result.synced;
    } catch (error) {
      this.setData({ syncStatus: '账户设置同步失败。', prefsError: error && error.message ? error.message : '请检查网络后重试。' });
      return false;
    }
  },

  async onLanguageChange(event) {
    const selected = LANGUAGES[Number(event.detail.value)];
    if (!selected) return;
    const synced = await this.persistPreference({ language: selected.code });
    this.setData({ prefsNotice: (synced ? '语言偏好已同步到 RUDA 账户。' : '语言偏好已保存在本设备；登录后可同步到 RUDA 账户。') + '小程序界面目前仅提供简体中文。' });
  },

  async onCurrencyChange(event) {
    const currency = CURRENCIES[Number(event.detail.value)];
    if (!currency) return;
    if (currency !== 'EUR') {
      this.setData({ prefsError: '' });
      try {
        await loadExchangeRates();
      } catch (error) {
        this.setData({ prefsError: '无法获取最新汇率，未更改展示货币。' });
        return;
      }
    }
    await this.persistPreference({ currency });
  },

  async onMonochromeChange(event) {
    const synced = await this.persistPreference({ monochrome: Boolean(event.detail.value) });
    this.setData({ prefsNotice: (synced ? '黑白显示偏好已同步到 RUDA 账户。' : '黑白显示偏好已保存在本设备；登录后可同步到 RUDA 账户。') + '此设置应用于支持该偏好的 Web 页面，小程序界面暂不切换黑白模式。' });
  },

  openAccount() {
    const session = getAuthSession();
    if (session && (session.role === 'merchant' || session.role === 'employee')) {
      wx.navigateTo({ url: '/pages/merchant/index' });
      return;
    }
    if (!session) {
      wx.navigateTo({ url: '/pages/login/index?returnTab=settings' });
      return;
    }
    wx.showModal({ title: roleLabels[session.role] || 'RUDA 账号', content: '你的账号已登录。', showCancel: false });
  },

  openEnterpriseCenter() {
    wx.navigateToMiniProgram({
      appId: MERCHANT_MINIPROGRAM_APP_ID,
      path: 'pages/dashboard/index',
      envVersion: 'release',
      fail: error => {
        console.error('[open-merchant-miniprogram]', error);
        wx.showToast({ title: '暂时无法打开商家后台，请稍后重试', icon: 'none' });
      }
    });
  },

  bindWechat() {
    if (!getAuthSession() || getAuthSession().role !== 'buyer') return;
    wx.navigateTo({ url: '/pages/login/index?role=buyer&returnTab=settings' });
  },

  showAnalyticsPrivacy() {
    wx.showModal({
      title: '分析与隐私',
      content: '小程序当前不加载 RUDA Web 的营销分析脚本，因此这里没有网页分析同意项。个人信息处理方式请查看隐私政策。',
      confirmText: '查看隐私政策',
      cancelText: '关闭',
      success: result => {
        if (result.confirm) wx.navigateTo({ url: '/pages/privacy/index' });
      }
    });
  },

  confirmLogout() {
    if (!getAuthSession()) return;
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新登录才能使用账户功能。',
      confirmText: '退出登录',
      cancelText: '取消',
      success: result => {
        if (!result.confirm) return;
        clearAuthSession();
        this.refreshSession();
        this.setData({ syncStatus: '设置保存在本设备；登录后可同步到 RUDA 账户。' });
        wx.showToast({ title: '已退出登录', icon: 'success' });
      }
    });
  },

  showAbout() {
    wx.showModal({ title: 'RUDA Fashion', content: 'RUDA 意大利时尚批发平台。', showCancel: false });
  }
});
