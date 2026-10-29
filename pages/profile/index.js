const { getAuthProfile, getBuyerAuthorizations, getBuyerNotifications, getBuyerOrders, getStoreByLookupCode } = require('../../utils/api');
const { getAuthSession, clearAuthSession } = require('../../utils/auth');
const { summarizeBuyerOrders, normalizeStoreCode } = require('../../utils/order-summary');

const roleLabels = { buyer: '采购商账号', merchant: '商家账号', employee: '员工账号' };

function firstCharacter(value) {
  const text = String(value || '').trim();
  return text ? text[0].toUpperCase() : 'R';
}

function storeCodeError(error) {
  if (!error) return '暂时无法验证，请稍后重试';
  if (error.status === 400 || error.code === 'MERCHANT_STORE_CODE_INVALID') return '授权码格式不正确，请输入 6 位数字';
  if (error.status === 404 || error.code === 'MERCHANT_STORE_NOT_FOUND') return '未找到该授权码对应的公开店铺';
  if (error.status === 429) return '验证次数过多，请稍后再试';
  if (error.status === 0 || error.code === 'NETWORK_ERROR') return '网络异常，请检查网络后重试';
  if (error.status === 401) return '登录状态已失效，请重新登录';
  return '暂时无法验证，请稍后重试';
}

Page({
  data: {
    isLoggedIn: false,
    isBuyer: false,
    hasMerchantAccess: false,
    displayName: '登录 RUDA 账号',
    identityMeta: '登录后管理订单与个人资料',
    statusLabel: '',
    statusTone: '',
    avatarUrl: '',
    initial: 'R',
    orderSummary: null,
    orderLoading: false,
    orderError: '',
    overviewNote: '',
    unreadCount: 0,
    notificationError: '',
    approvedAuthorizationCount: 0,
    authorizationError: '',
    codeModalOpen: false,
    codeInput: '',
    codeError: '',
    codeLoading: false
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 4 });
    this.refreshIdentity();
    this.loadOverview();
  },

  onPullDownRefresh() {
    this.refreshIdentity();
    this.loadOverview().finally(() => wx.stopPullDownRefresh());
  },

  refreshIdentity() {
    const session = getAuthSession();
    if (!session) {
      this.setData({
        isLoggedIn: false,
        isBuyer: false,
        hasMerchantAccess: false,
        displayName: '登录 RUDA 账号',
        identityMeta: '登录后管理订单与个人资料',
        statusLabel: '',
        statusTone: '',
        avatarUrl: '',
        initial: 'R'
      });
      return;
    }
    const profile = session.profile || {};
    if (session.role === 'buyer') {
      const companyName = profile.companyName || '';
      const contact = profile.contactPerson || '';
      const city = profile.city || '';
      this.setData({
        isLoggedIn: true,
        isBuyer: true,
        hasMerchantAccess: false,
        displayName: contact || companyName || profile.email || 'RUDA 采购商',
        identityMeta: [companyName, city].filter(Boolean).join(' · ') || profile.email || roleLabels.buyer,
        statusLabel: profile.status === 'approved' ? '企业资质已通过' : '资质审核中',
        statusTone: profile.status === 'approved' ? 'approved' : 'pending',
        avatarUrl: profile.avatarUrl || '',
        initial: firstCharacter(contact || companyName || profile.email)
      });
      this.verifyBuyerSession();
      return;
    }
    const merchantName = (session.merchant && session.merchant.name) || profile.merchantName || '';
    this.setData({
      isLoggedIn: true,
      isBuyer: false,
      hasMerchantAccess: true,
      displayName: session.role === 'merchant'
        ? (merchantName || profile.name || profile.email || roleLabels.merchant)
        : (profile.name || roleLabels.employee),
      identityMeta: session.role === 'merchant'
        ? roleLabels.merchant + (merchantName ? ' · ' + merchantName : '')
        : roleLabels.employee + (merchantName ? ' · ' + merchantName : ''),
      statusLabel: session.role === 'merchant' ? '商家身份' : '员工身份',
      statusTone: 'approved',
      avatarUrl: '',
      initial: firstCharacter(profile.name || merchantName)
    });
  },

  async verifyBuyerSession() {
    try {
      const response = await getAuthProfile('buyer');
      if (response && response.success === false) {
        clearAuthSession();
        this.setData({
          isLoggedIn: false,
          isBuyer: false,
          displayName: '登录 RUDA 账号',
          identityMeta: '登录后管理订单与个人资料',
          statusLabel: '',
          statusTone: '',
          avatarUrl: '',
          initial: 'R',
          orderSummary: null,
          overviewNote: '登录后查看订单与状态',
          unreadCount: 0,
          approvedAuthorizationCount: 0
        });
      }
    } catch (_error) {
      // 网络异常时保留本地会话，避免把可恢复故障当成退出登录。
    }
  },

  loadOverview() {
    const session = getAuthSession();
    if (!session) {
      this.setData({
        orderSummary: null,
        orderError: '',
        overviewNote: '登录后查看订单与状态',
        unreadCount: 0,
        notificationError: '',
        approvedAuthorizationCount: 0,
        authorizationError: ''
      });
      return Promise.resolve();
    }
    if (session.role !== 'buyer') {
      this.setData({
        orderSummary: null,
        orderError: '',
        overviewNote: '商家订单请在商家中心处理',
        unreadCount: 0,
        notificationError: '',
        approvedAuthorizationCount: 0,
        authorizationError: ''
      });
      return Promise.resolve();
    }
    this.setData({ orderLoading: true, orderError: '', overviewNote: '' });
    const settle = promise => promise
      .then(response => ({ response }))
      .catch(error => ({ error }));
    return Promise.all([
      settle(getBuyerOrders()),
      settle(getBuyerNotifications(30)),
      settle(getBuyerAuthorizations())
    ]).then(results => {
      const ordersResult = results[0];
      const notificationsResult = results[1];
      const authorizationsResult = results[2];
      const authorizations = authorizationsResult.response && Array.isArray(authorizationsResult.response.authorizations)
        ? authorizationsResult.response.authorizations
        : [];
      this.setData({
        orderLoading: false,
        orderSummary: ordersResult.response
          ? summarizeBuyerOrders(ordersResult.response.orders || [])
          : null,
        orderError: ordersResult.error ? (ordersResult.error.message || '订单暂时无法加载') : '',
        unreadCount: notificationsResult.response && typeof notificationsResult.response.unread === 'number'
          ? notificationsResult.response.unread
          : 0,
        notificationError: notificationsResult.error ? '消息暂时无法加载' : '',
        approvedAuthorizationCount: authorizations.filter(item => item.status === 'approved').length,
        authorizationError: authorizationsResult.error ? '授权暂时无法加载' : ''
      });
    });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/index?returnTab=profile' });
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },

  openIdentity() {
    if (this.data.isLoggedIn) {
      this.openSettings();
      return;
    }
    this.goLogin();
  },

  openOrders(event) {
    const filter = (event && event.currentTarget && event.currentTarget.dataset.filter) || 'all';
    if (!getAuthSession()) {
      this.goLogin();
      return;
    }
    wx.navigateTo({ url: '/pages/orders/index?filter=' + encodeURIComponent(filter) });
  },

  openAuthorizations() {
    if (!getAuthSession()) {
      this.goLogin();
      return;
    }
    wx.navigateTo({ url: '/pages/authorizations/index' });
  },

  openNotifications() {
    if (!getAuthSession()) {
      this.goLogin();
      return;
    }
    wx.navigateTo({ url: '/pages/notifications/index' });
  },

  openSupport() {
    wx.navigateTo({ url: '/pages/support/index' });
  },

  openPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },

  openTerms() {
    wx.navigateTo({ url: '/pages/service-agreement/index' });
  },

  openMerchantWorkspace() {
    wx.navigateTo({ url: '/pages/merchant/index' });
  },

  openMerchantTab() {
    wx.switchTab({ url: '/pages/merchants/index' });
  },

  openCodeModal() {
    this.setData({ codeModalOpen: true, codeInput: '', codeError: '', codeLoading: false });
  },

  closeCodeModal() {
    if (this.data.codeLoading) return;
    this.setData({ codeModalOpen: false, codeError: '' });
  },

  onCodeInput(event) {
    this.setData({ codeInput: String(event.detail.value || ''), codeError: '' });
  },

  noop() {},

  async submitCode() {
    if (this.data.codeLoading) return;
    const normalized = normalizeStoreCode(this.data.codeInput);
    if (normalized.error) {
      this.setData({ codeError: normalized.error });
      return;
    }
    this.setData({ codeLoading: true, codeError: '' });
    try {
      const response = await getStoreByLookupCode(normalized.code);
      const storeSlug = response && response.storeSlug;
      if (!storeSlug) {
        this.setData({ codeLoading: false, codeError: '未找到该授权码对应的公开店铺' });
        return;
      }
      this.setData({ codeLoading: false, codeModalOpen: false, codeInput: '' });
      wx.navigateTo({ url: '/pages/store/index?storeSlug=' + encodeURIComponent(storeSlug) });
    } catch (error) {
      this.setData({ codeLoading: false, codeError: storeCodeError(error) });
    }
  }
});
