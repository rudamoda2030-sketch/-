const { getAssetUrl, getMerchants, getProducts } = require('../../utils/api');
const { formatEurAmount } = require('../../utils/preferences');

Page({
  data: {
    searchText: '',
    products: [],
    merchants: [],
    loading: false,
    productError: '',
    merchantError: ''
  },

  onLoad() {
    this.loadData();
  },

  onShow() {
    this.setData({ products: (this.data.products || []).map(product => Object.assign({}, product, { displayPrice: formatEurAmount(product.wholesalePrice) || ('€' + product.wholesalePrice) || ('€' + product.wholesalePrice) })) });
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 4 });
  },

  async loadData(search = '') {
    this.setData({ loading: true, productError: '', merchantError: '' });
    const results = await Promise.all([
      getProducts(search ? { search } : {})
        .then(response => ({ response }))
        .catch(error => ({ error })),
      getMerchants()
        .then(response => ({ response }))
        .catch(error => ({ error }))
    ]);
    const productsResult = results[0];
    const merchantsResult = results[1];

    this.setData({
      products: productsResult.response
        ? (productsResult.response.products || []).map(product => ({
            ...product,
            coverImage: getAssetUrl(product.images && product.images[0]),
            displayPrice: formatEurAmount(product.wholesalePrice) || ('€' + product.wholesalePrice)
          }))
        : [],
      merchants: merchantsResult.response
        ? (merchantsResult.response.merchants || []).slice(0, 8).map(merchant => ({
            ...merchant,
            logoUrl: getAssetUrl(merchant.logo)
          }))
        : [],
      productError: productsResult.error ? productsResult.error.message : '',
      merchantError: merchantsResult.error ? merchantsResult.error.message : '',
      loading: false
    });
  },

  onSearchInput(event) {
    this.setData({ searchText: event.detail.value });
  },

  onSearchConfirm() {
    this.loadData(this.data.searchText.trim());
  },

  onPullDownRefresh() {
    this.loadData(this.data.searchText.trim()).finally(() => wx.stopPullDownRefresh());
  },

  openProduct(event) {
    const productId = event.currentTarget.dataset.id;
    if (productId) wx.navigateTo({ url: `/pages/product/index?productId=${encodeURIComponent(productId)}` });
  },

  openStore(event) {
    const storeSlug = event.currentTarget.dataset.slug;
    if (storeSlug) wx.navigateTo({ url: `/pages/store/index?storeSlug=${encodeURIComponent(storeSlug)}` });
  },

  openCart() {
    wx.navigateTo({ url: '/pages/cart/index' });
  },

  openOrders() {
    wx.navigateTo({ url: '/pages/orders/index' });
  },

  openMerchantWorkspace() {
    wx.navigateTo({ url: '/pages/merchant/index' });
  }
});
