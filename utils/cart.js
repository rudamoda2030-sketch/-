const CART_STORAGE_KEY = 'ruda_mini_cart';

function readCart() {
  const items = wx.getStorageSync(CART_STORAGE_KEY);
  return Array.isArray(items) ? items.filter(item =>
    item && typeof item.productId === 'string' && typeof item.sku === 'string'
    && Number.isInteger(item.quantity) && item.quantity > 0
  ) : [];
}

function writeCart(items) {
  wx.setStorageSync(CART_STORAGE_KEY, items);
  return items;
}

function addCartItem(item) {
  if (!item || typeof item.productId !== 'string' || typeof item.sku !== 'string'
    || !Number.isInteger(item.quantity) || item.quantity < 1) {
    throw new Error('CART_ITEM_INVALID');
  }
  const items = readCart();
  const existing = items.find(entry => entry.productId === item.productId && entry.sku === item.sku);
  if (existing) existing.quantity += item.quantity;
  else items.push({ ...item });
  return writeCart(items);
}

function updateCartQuantity(productId, sku, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    return removeCartItem(productId, sku);
  }
  return writeCart(readCart().map(item =>
    item.productId === productId && item.sku === sku ? { ...item, quantity } : item
  ));
}

function removeCartItem(productId, sku) {
  return writeCart(readCart().filter(item => item.productId !== productId || item.sku !== sku));
}

function clearCart() {
  wx.removeStorageSync(CART_STORAGE_KEY);
}

module.exports = { CART_STORAGE_KEY, readCart, addCartItem, updateCartQuantity, removeCartItem, clearCart };
