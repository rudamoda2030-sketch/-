const { getAssetUrl, getMerchants, getStoreByLookupCode, getVaultStatuses, requestVaultAccess } = require('../../utils/api');
const { getAuthSession } = require('../../utils/auth');

function displayValue(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return /demo|example|演示|示例|占位|待完善|未填写|待补充|待填写/i.test(text) ? '' : text;
}

function normalizeWebsite(value) {
  if (typeof value !== 'string') return '';
  const input = value.trim().replace(/[。．]/g, '.');
  if (!input || input.length > 200) return '';
  const normalized = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  return /^https?:\/\/[^/\s?#]+\.[^/\s?#]+(?:[/?#][^\s]*)?$/i.test(normalized) ? normalized : '';
}

function getCategory(merchant) {
  const specialty = displayValue(merchant.specialtyCategory);
  if (specialty) return specialty;
  const industry = String(merchant.industry || '').toUpperCase().replace(/[\s-]+/g, '_');
  const categories = {
    FASHION_COMPANY: '服装公司',
    FASHION_WHOLESALE: '服装批发',
    WHOLESALE_COMPANY: '服装批发',
    LEATHER_GOODS: '皮具批发',
    TRADING_COMPANY: '贸易公司',
    DEPARTMENT_STORE: '百货',
    RESTAURANT: '餐饮',
    RETAIL_STORE: '零售店'
  };
  if (categories[industry]) return categories[industry];
  const businessType = displayValue(merchant.businessType);
  if (/wholesal|distribut|批发|grossist/i.test(businessType)) return '服装批发';
  if (/retail|boutique|零售/i.test(businessType)) return '零售店';
  if (/leather|pelletteria|皮具/i.test(businessType)) return '皮具批发';
  if (/fashion|服装|apparel/i.test(businessType)) return '服装公司';
  return businessType || '时装品牌';
}

Page({
  data: {
    merchants: [],
    allMerchants: [],
    keyword: '',
    loading: false,
    error: ''
  },

  onLoad() {
    this.loadMerchants();
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 1 });
    if (this.data.merchants.length) this.loadMerchants();
  },

  async loadMerchants(searchTerm = '') {
    this.setData({ loading: true, error: '' });
    try {
      const response = await getMerchants(searchTerm);
      const merchants = (response.merchants || []).map(merchant => {
        const latitude = Number(merchant.mapLatitude);
        const longitude = Number(merchant.mapLongitude);
        const hasCoordinateValues = merchant.mapLatitude !== null && merchant.mapLatitude !== undefined
          && String(merchant.mapLatitude).trim() !== ''
          && merchant.mapLongitude !== null && merchant.mapLongitude !== undefined
          && String(merchant.mapLongitude).trim() !== '';
        const hasCoordinates = hasCoordinateValues
          && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
          && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
        const address = displayValue(merchant.showroomAddress)
          || [merchant.city, merchant.country].map(displayValue).filter(Boolean).join(', ');
        const phoneCandidate = displayValue(merchant.contactPhone) || displayValue(merchant.phone);
        const phone = phoneCandidate.replace(/[^\d+]/g, '').length >= 7 ? phoneCandidate : '';
        const description = displayValue(merchant.tagline_zh)
          || displayValue(merchant.tagline)
          || merchant.specialties?.map(displayValue).filter(Boolean).slice(0, 2).join('、')
          || displayValue(merchant.description_zh)
          || displayValue(merchant.description);
        return {
          ...merchant,
          logoUrl: getAssetUrl(merchant.logo),
          imageUrl: getAssetUrl(merchant.showroomImage || merchant.banner || merchant.logo),
          address,
          latitude,
          longitude,
          hasCoordinates,
          phone,
          websiteUrl: normalizeWebsite(merchant.websiteUrl),
          category: getCategory(merchant),
          description: description || '商家暂未填写主营介绍'
        };
      });
      const session = getAuthSession();
      if (session && session.role === 'buyer' && merchants.length) {
        try {
          const response = await getVaultStatuses(merchants.map(merchant => merchant.id));
          const statuses = response.statusByMerchant || {};
          merchants.forEach(merchant => {
            merchant.vaultStatus = statuses[merchant.id] || 'none';
          });
        } catch (error) {
          console.error('[mini-merchant-vault-status]', error);
          merchants.forEach(merchant => {
            merchant.vaultStatus = 'unknown';
          });
        }
      } else {
        merchants.forEach(merchant => {
          merchant.vaultStatus = 'none';
        });
      }
      this.setData({ allMerchants: merchants, merchants });
    } catch (error) {
      this.setData({ error: error.message || 'MERCHANTS_LOAD_FAILED' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onPullDownRefresh() {
    this.loadMerchants().finally(() => wx.stopPullDownRefresh());
  },

  openStore(event) {
    const { slug, id } = event.currentTarget.dataset;
    if (slug) {
      wx.navigateTo({ url: `/pages/store/index?storeSlug=${encodeURIComponent(slug)}` });
    } else if (id) {
      wx.navigateTo({ url: `/pages/store/index?shopId=${encodeURIComponent(id)}` });
    }
  },

  searchMerchants(event) {
    const keyword = String(event.detail.value || '').trim();
    this.setData({ keyword: event.detail.value || '', error: '' });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const requestId = (this.searchRequestId || 0) + 1;
    this.searchRequestId = requestId;
    if (!keyword) {
      this.setData({ merchants: this.data.allMerchants, loading: false });
      return;
    }
    this.searchTimer = setTimeout(async () => {
      this.setData({ loading: true });
      try {
        const response = await getMerchants(keyword);
        if (this.searchRequestId !== requestId) return;
        const merchants = (response.merchants || []).map(merchant => {
          const latitude = Number(merchant.mapLatitude);
          const longitude = Number(merchant.mapLongitude);
          const hasCoordinateValues = merchant.mapLatitude !== null && merchant.mapLatitude !== undefined
            && String(merchant.mapLatitude).trim() !== ''
            && merchant.mapLongitude !== null && merchant.mapLongitude !== undefined
            && String(merchant.mapLongitude).trim() !== '';
          const hasCoordinates = hasCoordinateValues
            && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
            && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
          const address = displayValue(merchant.showroomAddress)
            || [merchant.city, merchant.country].map(displayValue).filter(Boolean).join(', ');
          const phoneCandidate = displayValue(merchant.contactPhone) || displayValue(merchant.phone);
          const phone = phoneCandidate.replace(/[^\d+]/g, '').length >= 7 ? phoneCandidate : '';
          const description = displayValue(merchant.tagline_zh)
            || displayValue(merchant.tagline)
            || merchant.specialties?.map(displayValue).filter(Boolean).slice(0, 2).join('、')
            || displayValue(merchant.description_zh)
            || displayValue(merchant.description);
          return {
            ...merchant,
            logoUrl: getAssetUrl(merchant.logo),
            imageUrl: getAssetUrl(merchant.showroomImage || merchant.banner || merchant.logo),
            address,
            latitude,
            longitude,
            hasCoordinates,
            phone,
            websiteUrl: normalizeWebsite(merchant.websiteUrl),
            category: getCategory(merchant),
            description: description || '商家暂未填写主营介绍',
            vaultStatus: 'none'
          };
        });
        this.setData({ merchants });
      } catch (error) {
        if (this.searchRequestId !== requestId) return;
        this.setData({ error: error.message || 'MERCHANT_SEARCH_FAILED', merchants: [] });
      } finally {
        if (this.searchRequestId === requestId) this.setData({ loading: false });
      }
    }, 250);
  },

  async submitStoreSearch(event) {
    const code = String(event.detail.value || this.data.keyword || '').trim();
    if (!/^\d{6}$/.test(code)) {
      if (/^\d+$/.test(code)) this.setData({ error: '商家代码必须是完整的六位数字' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const result = await getStoreByLookupCode(code);
      if (!result.storeSlug) {
        this.setData({ error: '未找到该编号对应的公开店铺' });
        return;
      }
      wx.navigateTo({ url: `/pages/store/index?storeSlug=${encodeURIComponent(result.storeSlug)}` });
    } catch (error) {
      this.setData({
        error: error.status === 404 ? '未找到该编号对应的公开店铺' : error.message || 'STORE_LOOKUP_FAILED'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  openFindStore() {
    wx.navigateTo({ url: '/pages/find-store/index' });
  },

  navigateToMerchant(event) {
    const dataset = event.currentTarget.dataset;
    const latitude = Number(dataset.latitude);
    const longitude = Number(dataset.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    wx.openLocation({
      latitude,
      longitude,
      name: dataset.name || '',
      address: dataset.address || '',
      scale: 16,
      fail: () => wx.showToast({ title: '暂时无法打开地图', icon: 'none' })
    });
  },

  callMerchant(event) {
    const phoneNumber = String(event.currentTarget.dataset.phone || '').trim().replace(/[^\d+]/g, '');
    if (!phoneNumber) return;
    wx.makePhoneCall({
      phoneNumber,
      fail: () => wx.showToast({ title: '暂时无法拨打电话', icon: 'none' })
    });
  },

  async requestMerchantAccess(event) {
    const merchantId = String(event.currentTarget.dataset.id || '');
    const merchant = this.data.allMerchants.find(item => item.id === merchantId);
    if (!merchantId || !merchant) return;
    if (merchant.vaultStatus === 'approved') {
      this.openStore({ currentTarget: { dataset: { slug: merchant.storeSlug, id: merchant.id } } });
      return;
    }
    if (merchant.vaultStatus === 'pending') {
      wx.showToast({ title: '授权申请正在审核中', icon: 'none' });
      return;
    }
    if (merchant.vaultStatus === 'unknown') {
      await this.loadMerchants();
      return;
    }
    const session = getAuthSession();
    if (!session || session.role !== 'buyer') {
      wx.showModal({
        title: '登录买家账号',
        content: '登录后即可向商家提交看货授权申请。',
        confirmText: '去登录',
        success: result => {
          if (result.confirm) {
            wx.navigateTo({ url: '/pages/login/index?role=buyer&returnTab=merchants' });
          }
        }
      });
      return;
    }

    wx.showLoading({ title: '正在提交' });
    try {
      const result = await requestVaultAccess(merchantId);
      const vaultStatus = result.request && result.request.status === 'approved'
        ? 'approved'
        : result.request && result.request.status === 'pending' || result.message === '申请已在审核中'
          ? 'pending'
          : merchant.vaultStatus;
      const allMerchants = this.data.allMerchants.map(item => item.id === merchantId ? { ...item, vaultStatus } : item);
      const merchants = this.data.merchants.map(item => item.id === merchantId ? { ...item, vaultStatus } : item);
      this.setData({ allMerchants, merchants });
      if (vaultStatus === 'approved') {
        this.openStore({ currentTarget: { dataset: { slug: merchant.storeSlug, id: merchant.id } } });
      }
      wx.showModal({
        title: '授权申请',
        content: result.message || '申请已提交，请等待商家审核。',
        showCancel: false
      });
    } catch (error) {
      const code = error && (error.code || error.message);
      const message = code === 'BUYER_VERIFICATION_REQUIRED'
        ? '请先完成买家企业资质审核，再申请看货权限。'
        : error && error.status === 401
          ? '登录状态已失效，请重新登录后申请。'
          : '申请暂时未能提交，请稍后重试。';
      wx.showModal({
        title: '无法提交申请',
        content: message,
        showCancel: Boolean(error && error.status === 401),
        confirmText: error && error.status === 401 ? '去登录' : '知道了',
        success: result => {
          if (result.confirm && error && error.status === 401) {
            wx.navigateTo({ url: '/pages/login/index?role=buyer&returnTab=merchants' });
          }
        }
      });
    } finally {
      wx.hideLoading();
    }
  },

  openWebsite(event) {
    const url = String(event.currentTarget.dataset.url || '').trim();
    const merchantName = String(event.currentTarget.dataset.name || '');
    if (!/^https?:\/\/[^/\s?#]+(?:[/?#][^\s]*)?$/i.test(url)) return;
    wx.navigateTo({
      url: `/pages/webview/index?url=${encodeURIComponent(url)}&title=${encodeURIComponent(merchantName)}`,
      fail: () => wx.showToast({ title: '官网暂时无法打开，请检查微信业务域名配置', icon: 'none' })
    });
  },

  onShareAppMessage(event) {
    const merchantId = event && event.target && event.target.dataset && event.target.dataset.id
      || event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id;
    const merchant = this.data.allMerchants.find(item => item.id === merchantId);
    const query = merchant
      ? `shopId=${encodeURIComponent(merchant.id)}`
      : '';
    return {
      title: merchant ? `${merchant.name}｜RUDA 商家名片` : 'RUDA 商家目录',
      path: `/pages/store/index${query ? `?${query}` : ''}`
    };
  }
});
