const { getAssetUrl, getMerchants, getStoreByLookupCode, getStoreLookupQrUrl, redeemStoreAccessCode } = require('../../utils/api');
const { getAuthSession, getVerifiedAuthProfile } = require('../../utils/auth');

function decodeValue(value) {
  let decoded = String(value || '');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch (_error) {
      break;
    }
  }
  return decoded;
}

function extractAuthorizationCode(value) {
  const input = decodeValue(value).trim();
  const queryStart = input.indexOf('?');
  const query = queryStart >= 0 ? input.slice(queryStart + 1) : input;
  const parameters = {};
  query.split('&').forEach(part => {
    const separator = part.indexOf('=');
    if (separator < 0) return;
    parameters[decodeValue(part.slice(0, separator))] = decodeValue(part.slice(separator + 1));
  });
  if (parameters.scene) return extractAuthorizationCode(parameters.scene);
  const code = parameters.code || parameters.storeCode || parameters.accessCode || (queryStart < 0 ? input.split(/[/?#]/).pop() : '');
  if (/^\d{6}$/.test(code)) return code;
  return /^RUDA-[A-F0-9]{32}$/i.test(code) ? code.toUpperCase() : '';
}

Page({
  data: {
    storeCode: '',
    searchResults: [],
    message: '',
    loading: false,
    cardLoading: false,
    showMerchantCard: false,
    merchantCard: null,
    cardMessage: '',
    showMerchantAccountActions: false
  },

  onLoad(options) {
    const incoming = options && (options.code || options.storeCode || options.accessCode || options.scene || options.q);
    const code = extractAuthorizationCode(incoming);
    if (code) {
      this.setData({ storeCode: code });
      this.redeemCode(code);
    }
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 3 });
  },

  onCodeInput(event) {
    this.setData({ storeCode: String(event.detail.value || ''), message: '', searchResults: [] });
  },

  onSubmit(event) {
    const query = event && event.detail && event.detail.value
      ? String(event.detail.value).trim()
      : this.data.storeCode.trim();
    this.setData({ storeCode: query });
    this.redeemCode(query);
  },

  findStore() {
    this.redeemCode(this.data.storeCode.trim());
  },

  openAllMerchants() {
    wx.switchTab({ url: '/pages/merchants/index' });
  },

  openDiscountHome() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  openMerchantRegistration() {
    const url = 'https://modaui.com/register-wholesale?registration=merchant';
    wx.navigateTo({
      url: `/pages/webview/index?url=${encodeURIComponent(url)}&title=${encodeURIComponent('商家入驻')}`
    });
  },

  openMerchantLogin() {
    wx.navigateTo({ url: '/pages/login/index?role=merchant' });
  },

  async showMyCard() {
    if (this.data.showMerchantCard) {
      this.setData({ showMerchantCard: false });
      return;
    }
    if (this.data.cardLoading) return;
    this.setData({ cardLoading: true, cardMessage: '' });
    try {
      const session = getAuthSession();
      if (!session || !['merchant', 'employee'].includes(session.role)) {
        this.setData({
          showMerchantCard: false,
          merchantCard: null,
          showMerchantAccountActions: true,
          cardMessage: '注册商家账号后即可拥有自己的名片'
        });
        return;
      }

      const verified = await getVerifiedAuthProfile();
      if (!verified || !['merchant', 'employee'].includes(verified.session.role) || !verified.response.merchant) {
        this.setData({
          showMerchantCard: false,
          merchantCard: null,
          showMerchantAccountActions: true,
          cardMessage: '商家登录状态已失效，请重新登录'
        });
        return;
      }

      const merchant = verified.response.merchant;
      const canShareStore = merchant.storefrontEnabled === true
        || (merchant.storefrontEnabled == null && merchant.isVerified === true);
      this.setData({
        showMerchantCard: true,
        merchantCard: {
          name: merchant.name,
          code: merchant.storeLookupCode,
          qrUrl: canShareStore && merchant.storeLookupCode ? getStoreLookupQrUrl(merchant.storeLookupCode) : '',
          city: merchant.city,
          country: merchant.country,
          storeSlug: canShareStore ? merchant.storeSlug : '',
          logoUrl: getAssetUrl(merchant.logo),
          logoFallback: String(merchant.name || 'R').slice(0, 1)
        },
        cardMessage: '',
        showMerchantAccountActions: false
      });
    } catch (error) {
      this.setData({
        showMerchantCard: false,
        merchantCard: null,
        showMerchantAccountActions: false,
        cardMessage: '暂时无法识别商家身份，请稍后重试'
      });
      console.error('[mini-find-store-merchant-card]', error);
    } finally {
      this.setData({ cardLoading: false });
    }
  },

  onShareAppMessage() {
    const merchant = this.data.merchantCard;
    if (!merchant || !merchant.storeSlug) return { title: 'RUDA 找店', path: '/pages/find-store/index' };
    return {
      title: `${merchant.name}｜RUDA 商家名片`,
      path: merchant.code
        ? `/pages/find-store/index?code=${encodeURIComponent(merchant.code)}`
        : `/pages/store/index?storeSlug=${encodeURIComponent(merchant.storeSlug || '')}`
    };
  },

  async redeemCode(input) {
    const code = String(input || '').trim();
    if (this.data.loading) return;
    if (!code) {
      this.setData({ message: '请输入六位商家代码、商家名称或授权代码' });
      return;
    }
    this.setData({ loading: true, message: '', searchResults: [] });
    try {
      if (/^\d{6}$/.test(code)) {
        const result = await getStoreByLookupCode(code);
        if (!result.storeSlug) {
          this.setData({ message: '未找到该编号对应的公开店铺' });
          return;
        }
        wx.navigateTo({
          url: '/pages/store/index?storeSlug=' + encodeURIComponent(result.storeSlug)
        });
        return;
      }
      if (/^\d+$/.test(code)) {
        this.setData({ message: '商家代码必须是完整的六位数字' });
        return;
      }
      if (/^RUDA-[A-F0-9]{32}$/i.test(code)) {
        const result = await redeemStoreAccessCode(code.toUpperCase());
        if (!result.storeSlug) {
          this.setData({ message: '授权验证失败，请确认代码有效' });
          return;
        }
        wx.navigateTo({ url: '/pages/store/index?storeSlug=' + encodeURIComponent(result.storeSlug) });
        return;
      }
      const result = await getMerchants(code);
      const merchants = (result.merchants || []).filter(merchant => merchant.storeSlug);
      this.setData({
        searchResults: merchants.map(merchant => ({
          id: merchant.id,
          name: merchant.name,
          storeSlug: merchant.storeSlug,
          city: merchant.city,
          country: merchant.country,
          logoUrl: getAssetUrl(merchant.logo),
          logoFallback: String(merchant.name || 'R').slice(0, 1)
        })),
        message: merchants.length ? '' : '没有找到公开店铺，请检查商家名称后重试'
      });
    } catch (error) {
      if (/^\d{6}$/.test(code) && (error.status === 404 || error.code === 'MERCHANT_STORE_NOT_FOUND')) {
        this.setData({ message: '未找到该编号对应的公开店铺' });
      } else if (error.status === 401) {
        this.setData({ message: '请登录买家账号后验证授权代码' });
      } else if (error.status === 403 && error.code === 'BUYER_VERIFICATION_REQUIRED') {
        this.setData({ message: '企业资质审核通过后才可进入私人商城' });
      } else if (error.status === 404 || error.code === 'STORE_ACCESS_CREDENTIAL_INVALID') {
        this.setData({ message: '授权代码无效、已撤销或已停用' });
      } else if (error.status === 429) {
        this.setData({ message: '验证次数过多，请稍后再试' });
      } else {
        this.setData({ message: '暂时无法验证，请稍后重试' });
        console.error('[mini-find-store-redeem]', error);
      }
    } finally {
      this.setData({ loading: false });
    }
  },

  openSearchResult(event) {
    const storeSlug = String(event.currentTarget.dataset.slug || '');
    if (storeSlug) wx.navigateTo({ url: `/pages/store/index?storeSlug=${encodeURIComponent(storeSlug)}` });
  },

  scanStore() {
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['qrCode'],
      success: result => {
        const code = extractAuthorizationCode(result.path || result.result);
        if (!code) {
          this.setData({ message: '二维码无效，请扫描商家提供的店铺码或授权码' });
          return;
        }
        this.setData({ storeCode: code });
        this.redeemCode(code);
      },
      fail: error => {
        if (error && error.errMsg && error.errMsg.toLowerCase().indexOf('cancel') >= 0) return;
        this.setData({ message: '无法识别二维码，请重试' });
      }
    });
  }
});
