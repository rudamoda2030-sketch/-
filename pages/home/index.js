const { getAssetUrl, getMerchants, getProducts } = require('../../utils/api');

const MAX_HOME_MERCHANTS = 10;
const HERO_VIDEO_URL = 'https://ruda.fashion/videos/ruda-home-hero.mp4?v=20261017-corpfix';
const FEED_VIDEO_URL = 'https://ruda.fashion/videos/ruda-fashion.mp4?v=20261017-corpfix';
const LAYOUT_PATTERN = [
  { size: 'medium', rows: 2 },
  { size: 'large', rows: 1 },
  { size: 'medium', rows: 3 },
  { size: 'large', rows: 3 },
  { size: 'medium', rows: 2 },
  { size: 'large', rows: 4 }
];

function interleaveMerchants(products) {
  const groups = new Map();
  products.forEach(product => {
    const key = product.merchantId || product.merchantName || 'independent';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(product);
  });

  const mixed = [];
  while (groups.size) {
    groups.forEach((merchantProducts, merchantId) => {
      const next = merchantProducts.shift();
      if (next) mixed.push(next);
      if (!merchantProducts.length) groups.delete(merchantId);
    });
  }
  return mixed;
}

function getHomeProductImages(product) {
  return (product.images || []).map(image => {
    let url = getAssetUrl(image);
    if (!url) return '';
    if (url.startsWith('https://b2b.ruda.fashion/')) {
      url = url.replace('https://b2b.ruda.fashion/', 'https://ruda.fashion/');
    }
    if (String(product.merchantId || '').startsWith('ruda-demo-merchant-')
      && url.startsWith('https://images.ruda.fashion/')) {
      return getAssetUrl('/demo-products/category-scarves.jpg');
    }
    return url;
  }).filter(Boolean);
}

Page({
  data: {
    feedItems: [{ key: 'opening-video', type: 'video', isHero: true, videoUrl: HERO_VIDEO_URL }],
    loading: false,
    statusBarHeight: 0,
    navBarHeight: 44
  },

  onLoad() {
    const systemInfo = wx.getSystemInfoSync();
    const statusBarHeight = systemInfo.statusBarHeight || 0;
    const menuButton = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
    const navBarHeight = menuButton
      ? menuButton.height + (menuButton.top - statusBarHeight) * 2
      : 44;
    this.setData({ statusBarHeight, navBarHeight });
    this.loadProducts();
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: -1 });
  },

  async loadProducts() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    const results = await Promise.all([
      getProducts()
        .then(response => ({ response }))
        .catch(error => ({ error })),
      getMerchants()
        .then(response => ({ response }))
        .catch(error => ({ error }))
    ]);
    const productsResult = results[0];
    const merchantsResult = results[1];

    if (productsResult.error) {
      console.error('[mini-home-products]', productsResult.error);
    }
    if (merchantsResult.error) {
      console.error('[mini-home-merchants]', merchantsResult.error);
    }

    const products = productsResult.response
      ? interleaveMerchants((productsResult.response.products || [])
          .filter(product => (product.visibility === undefined || product.visibility === 'public')
            && !product.isPrivateVault
            && !product.isExclusiveProtected
            && !product.isLockedForBuyer
            && !['draft', 'pending_review', 'rejected', 'archived'].includes(product.lifecycleStatus))
          .map(product => ({
            ...product,
            images: getHomeProductImages(product)
          }))
          .filter(product => product.images.length > 0))
      : [];
    const demoMerchantProducts = products.filter(product =>
      String(product.merchantId || '').startsWith('ruda-demo-merchant-'));
    const demoProducts = demoMerchantProducts.slice(0, 3);
    const feedProducts = products.filter(product =>
      !String(product.merchantId || '').startsWith('ruda-demo-merchant-'));
    const merchants = merchantsResult.response
      ? (merchantsResult.response.merchants || [])
          .filter(merchant => merchant.storeSlug)
          .map(merchant => ({
            ...merchant,
            image: getAssetUrl(merchant.showroomImage || merchant.banner || merchant.logo)
          }))
          .filter(merchant => merchant.image)
          .sort((first, second) => Number(second.id.startsWith('ruda-demo-merchant-')) - Number(first.id.startsWith('ruda-demo-merchant-')))
          .slice(0, MAX_HOME_MERCHANTS)
      : [];

    this._products = feedProducts;
    this._merchants = merchants;
    this._demoProducts = demoProducts;
    this._demoMerchantName = demoProducts[0] && demoProducts[0].merchantName || '';
    this._visibleCount = 20;
    this.updateFeed();
    this.setData({ loading: false });
  },

  updateFeed() {
    const products = this._products || [];
    const requestedCount = Math.min(this._visibleCount || 20, products.length);
    let visibleCount = 0;
    let layoutIndex = 0;
    while (visibleCount < requestedCount) {
      const layout = LAYOUT_PATTERN[layoutIndex % LAYOUT_PATTERN.length];
      visibleCount = Math.min(visibleCount + layout.rows * (layout.size === 'medium' ? 2 : 1), products.length);
      layoutIndex += 1;
    }

    const items = [{
      key: 'opening-video',
      type: 'video',
      isHero: true,
      videoUrl: HERO_VIDEO_URL,
      poster: products[0] && products[0].images[0]
    }];
    if (this._demoProducts && this._demoProducts.length) {
      items.push({
        key: 'public-demo-products',
        type: 'demo-products',
        merchantName: this._demoMerchantName,
        products: this._demoProducts
      });
    }
    let cursor = 0;
    let blockIndex = 0;
    let merchantIndex = 0;
    while (cursor < visibleCount) {
      const layout = LAYOUT_PATTERN[blockIndex % LAYOUT_PATTERN.length];
      const itemCount = layout.rows * (layout.size === 'medium' ? 2 : 1);
      const blockProducts = products.slice(cursor, cursor + itemCount);
      items.push({
        key: `products-${blockIndex}`,
        type: 'products',
        layout: layout.size,
        products: blockProducts.map((product, productIndex) => ({
          ...product,
          isFeature: layout.size === 'large'
        }))
      });
      cursor += blockProducts.length;

      if (blockIndex % 3 === 2 && cursor < products.length) {
        items.push({
          key: `video-${blockIndex}`,
          type: 'video',
          isHero: false,
          videoUrl: FEED_VIDEO_URL,
          poster: blockProducts[0] && blockProducts[0].images[0]
        });
      }
      if (blockIndex % 2 === 1 && this._merchants && this._merchants[merchantIndex]) {
        const merchant = this._merchants[merchantIndex];
        items.push({
          key: `merchant-${merchant.id}`,
          type: 'merchant',
          image: merchant.image,
          id: merchant.id,
          storeSlug: merchant.storeSlug
        });
        merchantIndex += 1;
      }
      blockIndex += 1;
    }

    if (this._merchants) {
      while (merchantIndex < this._merchants.length) {
        const merchant = this._merchants[merchantIndex];
        items.push({
          key: `merchant-${merchant.id}`,
          type: 'merchant',
          image: merchant.image,
          id: merchant.id,
          storeSlug: merchant.storeSlug
        });
        merchantIndex += 1;
      }
    }

    this.setData({
      feedItems: items.length ? items : [{ key: 'brand-film', type: 'video' }]
    });
  },

  onReachBottom() {
    if (this._visibleCount >= (this._products || []).length) return;
    this._visibleCount = Math.min(this._visibleCount + 12, this._products.length);
    this.updateFeed();
  },

  onPullDownRefresh() {
    this.loadProducts().finally(() => wx.stopPullDownRefresh());
  },

  openProduct(event) {
    const productId = event.currentTarget.dataset.id;
    if (productId) wx.navigateTo({ url: `/pages/product/index?productId=${encodeURIComponent(productId)}` });
  },

  openStore(event) {
    const storeSlug = event.currentTarget.dataset.slug;
    if (storeSlug) wx.navigateTo({ url: `/pages/store/index?storeSlug=${encodeURIComponent(storeSlug)}` });
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  }
});
