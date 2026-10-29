const { getAssetUrl, getMerchants, getProducts, getStoreBySlug } = require('../../utils/api');
const { formatEurAmount } = require('../../utils/preferences');

Page({
  data: {
    storeSlug: '',
    merchant: null,
    products: [],
    loading: false,
    error: ''
  },

  onShow() {
    this.setData({ products: (this.data.products || []).map(product => Object.assign({}, product, { displayPrice: formatEurAmount(product.wholesalePrice) || ('€' + product.wholesalePrice) || ('€' + product.wholesalePrice) })) });
  },

  async onLoad(options) {
    const storeSlug = typeof options.storeSlug === 'string' ? options.storeSlug : '';
    const shopId = typeof options.shopId === 'string' ? options.shopId : '';
    this.setData({
      storeSlug,
      loading: Boolean(storeSlug || shopId)
    });
    if (!storeSlug && !shopId) return;

    try {
      let merchantResponse;
      if (storeSlug) {
        merchantResponse = await getStoreBySlug(storeSlug);
      } else {
        const merchantsResponse = await getMerchants();
        const merchant = (merchantsResponse.merchants || []).find(item => item.id === shopId);
        if (!merchant || !merchant.storeSlug) {
          throw new Error('MERCHANT_STORE_NOT_FOUND');
        }
        this.setData({ storeSlug: merchant.storeSlug });
        merchantResponse = await getStoreBySlug(merchant.storeSlug);
      }
      const merchant = merchantResponse.merchant;
      const productsResponse = await getProducts({ merchantId: merchant.id });
      this.setData({
        merchant: {
          ...merchant,
          logoUrl: getAssetUrl(merchant.logo),
          bannerUrl: getAssetUrl(merchant.banner)
        },
        products: (productsResponse.products || []).map(product => ({
          ...product,
          coverImage: getAssetUrl(product.images && product.images[0]),
          displayPrice: formatEurAmount(product.wholesalePrice) || ('€' + product.wholesalePrice)
        }))
      });
    } catch (error) {
      this.setData({ error: error.message || 'STORE_LOAD_FAILED' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onShareAppMessage() {
    const query = this.data.storeSlug
      ? `storeSlug=${encodeURIComponent(this.data.storeSlug)}`
      : this.data.shopId
        ? `shopId=${encodeURIComponent(this.data.shopId)}`
        : '';
    return {
      title: 'RUDA 品牌独立店铺',
      path: `/pages/store/index${query ? `?${query}` : ''}`
    };
  },

  openProduct(event) {
    const productId = event.currentTarget.dataset.id;
    if (productId) wx.navigateTo({ url: `/pages/product/index?productId=${encodeURIComponent(productId)}` });
  }
});
