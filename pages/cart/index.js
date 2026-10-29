const { getAssetUrl } = require('../../utils/api');
const { getAuthSession } = require('../../utils/auth');
const { readCart, updateCartQuantity, removeCartItem } = require('../../utils/cart');
const { formatEurAmount } = require('../../utils/preferences');

function presentItem(item) {
  return {
    ...item,
    cartKey: `${item.productId}:${item.sku}`,
    imageUrl: getAssetUrl(item.image),
    lineTotal: (Number(item.unitPrice) * item.quantity).toFixed(2),
    displayLineTotal: formatEurAmount(Number(item.unitPrice) * item.quantity) || ('€' + (Number(item.unitPrice) * item.quantity).toFixed(2))
  };
}

Page({
  data: { items: [], totalQty: 0, estimatedTotal: '0.00' },

  onShow() {
    this.refreshCart();
  },

  refreshCart() {
    const items = readCart();
    this.setData({
      items: items.map(presentItem),
      totalQty: items.reduce((sum, item) => sum + item.quantity, 0),
      estimatedTotal: items.reduce((sum, item) => sum + Number(item.unitPrice || 0) * item.quantity, 0).toFixed(2),
      displayEstimatedTotal: formatEurAmount(items.reduce((sum, item) => sum + Number(item.unitPrice || 0) * item.quantity, 0)) || ('€' + items.reduce((sum, item) => sum + Number(item.unitPrice || 0) * item.quantity, 0).toFixed(2))
    });
  },

  changeQuantity(event) {
    const { id, sku, delta } = event.currentTarget.dataset;
    const item = readCart().find(entry => entry.productId === id && entry.sku === sku);
    if (!item) return;
    const nextQuantity = item.quantity + Number(delta);
    if (nextQuantity < 1) {
      removeCartItem(id, sku);
    } else {
      updateCartQuantity(id, sku, nextQuantity);
    }
    this.refreshCart();
  },

  removeItem(event) {
    removeCartItem(event.currentTarget.dataset.id, event.currentTarget.dataset.sku);
    this.refreshCart();
  },

  openProduct(event) {
    const id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/product/index?productId=${encodeURIComponent(id)}` });
  },

  browseMarket() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  checkout() {
    if (!this.data.items.length) return;
    const session = getAuthSession();
    if (!session || session.role !== 'buyer') {
      wx.navigateTo({ url: '/pages/login/index?role=buyer' });
      return;
    }
    wx.navigateTo({ url: '/pages/checkout/index' });
  }
});
