const { getAssetUrl, getProduct } = require('../../utils/api');
const { getAuthSession } = require('../../utils/auth');
const { addCartItem, readCart } = require('../../utils/cart');
const { formatEurAmount } = require('../../utils/preferences');

const COLOR_LABELS = {
  Black: '黑色',
  White: '白色',
  Navy: '藏青色',
  Blue: '蓝色',
  Red: '红色',
  Green: '绿色',
  Beige: '米色',
  Brown: '棕色',
  Grey: '灰色',
  Gray: '灰色',
  Pink: '粉色',
  Yellow: '黄色',
  Orange: '橙色',
  Purple: '紫色',
  OneSize: '均码',
  'One Size': '均码'
};

function getMedia(product) {
  const source = Array.isArray(product.media) && product.media.length
    ? product.media
    : (product.images || []).map((url, index) => ({ id: `image-${index}`, type: 'image', url }));
  return source.map((item, index) => ({
    id: item.id || `media-${index}`,
    type: item.type === 'video' ? 'video' : 'image',
    url: getProductAssetUrl(item.url, product),
    poster: getAssetUrl(item.poster || item.thumbnail || ''),
    index
  })).filter(item => item.url);
}

function getProductAssetUrl(value, product) {
  let url = getAssetUrl(value);
  if (url.startsWith('https://b2b.ruda.fashion/')) {
    url = url.replace('https://b2b.ruda.fashion/', 'https://ruda.fashion/');
  }
  if (String(product.id || '').startsWith('ruda-mini-demo-')
    && product.category === 'accessories'
    && url.startsWith('https://images.ruda.fashion/')) {
    return getAssetUrl('/demo-products/category-scarves.jpg');
  }
  return url;
}

function getColorLabel(color) {
  return COLOR_LABELS[color] || color || '—';
}

function normalizeSize(size) {
  const value = String(size || '').trim();
  return ['onesize', 'one size', 'one-size', 'os', '均码'].includes(value.toLowerCase()) ? '均码' : value || '均码';
}

function getWholesalePrice(product, quantity) {
  const minimumQuantity = Number(product.bulkPriceMinimumQuantity) || 100;
  const bulkPrice = Number(product.wholesalePrice100);
  if (quantity >= minimumQuantity && Number.isFinite(bulkPrice) && bulkPrice > 0) return bulkPrice;
  return Number(product.wholesalePrice) || 0;
}

function getSellableStock(sku) {
  return Math.max(0, (Number(sku && sku.stockCentral) || 0) - (Number(sku && sku.reserved) || 0));
}

function canBackorder(sku) {
  return sku && sku.allowBackorder !== false;
}

function createMatrix(product, quantities = {}, selectedColors = null) {
  const skus = (product.skus || []).filter(sku => sku.isActive !== false);
  const colors = [...new Map(skus.map(sku => [sku.color || '默认', sku])).values()];
  const colorOptions = colors.map(colorOption => ({
    color: colorOption.color || '默认',
    colorLabel: getColorLabel(colorOption.color || '默认'),
    colorCode: colorOption.colorCode || '#e5e0d9'
  }));
  const selectedColorSet = selectedColors
    ? new Set(selectedColors)
    : new Set(colorOptions.slice(0, 1).map(item => item.color));
  colorOptions.forEach(option => { option.selected = selectedColorSet.has(option.color); });
  const matrixRows = colors.filter(colorOption => selectedColorSet.has(colorOption.color || '默认')).map(colorOption => {
    const color = colorOption.color || '默认';
    const colorSkus = skus.filter(sku => (sku.color || '默认') === color);
    const colorSizes = [...new Set(colorSkus.map(item => normalizeSize(item.size)))];
    const cells = colorSizes.map(size => {
      const sku = colorSkus.find(item => normalizeSize(item.size) === size);
      const stock = getSellableStock(sku);
      const backorderAllowed = canBackorder(sku);
      return {
        sku: sku && sku.sku || '',
        size,
        key: sku && sku.sku || `${color}:${size}`,
        available: Boolean(sku) && (stock > 0 || backorderAllowed),
        stock,
        backorderAllowed,
        quantity: sku ? (backorderAllowed
          ? Math.max(0, Number(quantities[sku.sku]) || 0)
          : Math.min(stock, Math.max(0, Number(quantities[sku.sku]) || 0))) : 0
      };
    });
    return {
      color,
      colorLabel: getColorLabel(color),
      colorCode: colorOption.colorCode || '#e5e0d9',
      cells,
      quantity: cells.reduce((total, cell) => total + cell.quantity, 0),
      stock: cells.reduce((total, cell) => total + cell.stock, 0)
    };
  });
  return {
    matrixRows,
    skus: skus.map(sku => ({
      ...sku,
      color: sku.color || '默认',
      size: normalizeSize(sku.size),
      stockCentral: getSellableStock(sku),
      allowBackorder: canBackorder(sku),
      quantity: canBackorder(sku)
        ? Math.max(0, Number(quantities[sku.sku]) || 0)
        : Math.min(getSellableStock(sku), Math.max(0, Number(quantities[sku.sku]) || 0))
    })),
    colorOptions
  };
}

Page({
  data: {
    productId: '',
    sku: '',
    product: null,
    media: [],
    activeImageIndex: 0,
    colorOptions: [],
    selectedColors: [],
    matrixRows: [],
    skus: [],
    expandedColor: '',
    showDetails: false,
    selectedQuantity: 0,
    orderQuantity: 0,
    cartCount: 0,
    existingCartQuantity: 0,
    selectedSkuSummary: '',
    totalAmount: '€0.00',
    displayWholesalePrice: '€0.00',
    loading: false,
    error: '',
  },

  onShow() {
    if (this.data.product) this.refreshOrderSummary();
    this.setData({ cartCount: readCart().reduce((total, item) => total + item.quantity, 0) });
  },

  async onLoad(options) {
    const productId = typeof options.productId === 'string' ? options.productId : '';
    const requestedSku = typeof options.sku === 'string' ? options.sku : '';
    this.setData({ productId, sku: requestedSku, loading: Boolean(productId) });
    if (!productId) {
      this.setData({ error: 'PRODUCT_ID_REQUIRED' });
      return;
    }
    try {
      const response = await getProduct(productId);
      const product = {
        ...response.product,
        images: (response.product.images || [])
          .map(image => getProductAssetUrl(image, response.product))
          .filter(Boolean)
      };
      const media = getMedia(product);
      const requestedSkuItem = (product.skus || []).find(item => item.sku === requestedSku);
      const initialQuantities = requestedSkuItem
        ? { [requestedSkuItem.sku]: canBackorder(requestedSkuItem) || Number(requestedSkuItem.stockCentral) > 0 ? 1 : 0 }
        : {};
      const initialColors = [...new Set((product.skus || [])
        .filter(item => item.isActive !== false)
        .map(item => item.color || '默认'))];
      const selectedColors = requestedSkuItem
        ? [requestedSkuItem.color || '默认']
        : initialColors.slice(0, 1);
      const matrix = createMatrix(product, initialQuantities, selectedColors);
      const activeMedia = media[0];
      this.setData({
        product,
        media,
        images: media.filter(item => item.type === 'image').map(item => item.url),
        activeImageIndex: 0,
        colorOptions: matrix.colorOptions,
        selectedColors,
        matrixRows: matrix.matrixRows,
        skus: matrix.skus,
        expandedColor: selectedColors[0] || '',
      });
      if (activeMedia) this.setData({ activeMediaType: activeMedia.type });
      this.refreshOrderSummary();
    } catch (error) {
      this.setData({ error: error.message || 'PRODUCT_LOAD_FAILED' });
    } finally {
      this.setData({ loading: false });
    }
  },

  refreshOrderSummary() {
    const product = this.data.product;
    if (!product) return;
    const skus = this.data.skus || [];
    const selectedQuantity = skus.reduce((total, sku) => total + (Number(sku.quantity) || 0), 0);
    const existingCartQuantity = readCart()
      .filter(item => item.productId === product.id)
      .reduce((total, item) => total + item.quantity, 0);
    const orderQuantity = selectedQuantity + existingCartQuantity;
    const wholesalePrice = getWholesalePrice(product, orderQuantity);
    const selectedSkuSummary = skus
      .filter(sku => Number(sku.quantity) > 0)
      .map(sku => `${getColorLabel(sku.color)} / ${normalizeSize(sku.size)} × ${sku.quantity}`)
      .join('、');
    this.setData({
      selectedQuantity,
      existingCartQuantity,
      orderQuantity,
      selectedSkuSummary,
      cartCount: readCart().reduce((total, item) => total + item.quantity, 0),
      displayWholesalePrice: formatEurAmount(wholesalePrice) || `€${wholesalePrice.toFixed(2)}`,
      totalAmount: formatEurAmount(selectedQuantity * wholesalePrice) || `€${(selectedQuantity * wholesalePrice).toFixed(2)}`,
    });
  },

  onGalleryChange(event) {
    const activeImageIndex = Number(event.detail.current) || 0;
    const item = this.data.media[activeImageIndex];
    this.setData({
      activeImageIndex,
      activeMediaType: item ? item.type : 'image'
    });
  },

  selectMedia(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.media[index];
    if (!item) return;
    this.setData({ activeImageIndex: index, activeMediaType: item.type });
  },

  previewGallery() {
    const media = this.data.media || [];
    const imageUrls = media.filter(item => item.type === 'image').map(item => item.url);
    const active = media[this.data.activeImageIndex];
    if (active && active.type === 'image' && imageUrls.length) {
      wx.previewImage({ current: active.url, urls: imageUrls });
    }
  },

  onMatrixQuantityInput(event) {
    const skuCode = String(event.currentTarget.dataset.sku || '');
    const entered = String(event.detail.value || '').replace(/[^\d]/g, '');
    const sku = (this.data.skus || []).find(item => item.sku === skuCode);
    if (!sku) return;
    const requestedQuantity = Math.max(0, Number(entered) || 0);
    const quantity = sku.allowBackorder ? requestedQuantity : Math.min(sku.stockCentral, requestedQuantity);
    const quantities = Object.fromEntries((this.data.skus || []).map(item => [
      item.sku,
      item.sku === skuCode ? quantity : item.quantity
    ]));
    this.applyMatrixQuantities(quantities);
  },

  toggleColor(event) {
    const color = String(event.currentTarget.dataset.color || '');
    if (!color) return;
    const selected = new Set(this.data.selectedColors || []);
    const nextSelectedColors = selected.has(color)
      ? [...selected].filter(item => item !== color)
      : [...selected, color];
    if (nextSelectedColors.length === 0) {
      wx.showToast({ title: '请至少选择一个颜色', icon: 'none' });
      return;
    }
    const quantities = Object.fromEntries((this.data.skus || []).map(item => [
      item.sku,
      item.color === color && selected.has(color) ? 0 : item.quantity
    ]));
    this.applyMatrixQuantities(quantities, nextSelectedColors, nextSelectedColors.includes(color) ? color : '');
  },

  toggleColorPanel(event) {
    const color = String(event.currentTarget.dataset.color || '');
    this.setData({ expandedColor: this.data.expandedColor === color ? '' : color });
  },

  toggleProductDetails() {
    this.setData({ showDetails: !this.data.showDetails });
  },

  applyMatrixQuantities(quantities, selectedColors = this.data.selectedColors, expandedColor = this.data.expandedColor) {
    const product = this.data.product;
    if (!product) return;
    const matrix = createMatrix(product, quantities, selectedColors);
    this.setData({
      colorOptions: matrix.colorOptions,
      selectedColors: selectedColors || [],
      matrixRows: matrix.matrixRows,
      skus: matrix.skus,
      expandedColor: selectedColors.includes(expandedColor) ? expandedColor : selectedColors[0] || ''
    });
    this.refreshOrderSummary();
  },

  async orderNow() {
    const added = await this.addToCart();
    if (added) wx.navigateTo({ url: '/pages/checkout/index' });
  },

  openCustomerService() {
    const product = this.data.product;
    if (!product) return;
    const topics = ['询库存', '问批发价', '问交期', '咨询尺码'];
    wx.showActionSheet({
      itemList: topics,
      success: result => {
        const selectedItems = (this.data.skus || []).filter(sku => sku.quantity > 0);
        const selection = selectedItems.length
          ? selectedItems.map(sku => `${getColorLabel(sku.color)} / ${sku.size}：${sku.quantity} 件`).join('\n')
          : '暂未选择规格';
        const topic = topics[result.tapIndex] || topics[0];
        wx.setStorageSync('rudaProductSupportDraft', {
          subject: `${topic}：${product.name_zh || product.name}`,
          message: [
            `咨询事项：${topic}`,
            `商品：${product.name_zh || product.name}`,
            `款号：${product.styleNo || '—'}`,
            `已选颜色、尺码和数量：\n${selection}`
          ].join('\n')
        });
        wx.navigateTo({ url: '/pages/support/index?source=product' });
      },
      fail: error => {
        if (!String(error && error.errMsg || '').includes('cancel')) {
          console.error('[product-customer-service]', error);
          wx.showToast({ title: '暂时无法打开客服，请稍后重试', icon: 'none' });
        }
      }
    });
  },

  async addToCart() {
    const product = this.data.product;
    if (!product) return;
    if (this.data.selectedQuantity < Math.max(1, Number(product.moq) || 1)) {
      wx.showToast({ title: `起订量为 ${product.moq || 1} 件`, icon: 'none' });
      return false;
    }
    try {
      const unitPrice = getWholesalePrice(product, this.data.orderQuantity);
      (this.data.skus || []).filter(sku => sku.quantity > 0).forEach(sku => {
        addCartItem({
          productId: product.id,
          productName: product.name_zh || product.name,
          styleNo: product.styleNo,
          brand: product.brand,
          merchantId: product.merchantId,
          merchantName: product.merchantName,
          image: product.images && product.images[0],
          sku: sku.sku,
          color: sku.color || '',
          size: sku.size || '',
          quantity: sku.quantity,
          unitPrice,
          moq: Number(product.moq) || 1,
          packSize: Number(product.packSize) || 1
        });
      });
      wx.showToast({ title: '已加入采购车', icon: 'success' });
      this.applyMatrixQuantities({});
      return true;
    } catch (error) {
      wx.showToast({ title: error.message || '加入采购车失败', icon: 'none' });
      return false;
    }
  },

  onShareAppMessage() {
    const query = this.data.productId
      ? `productId=${encodeURIComponent(this.data.productId)}${this.data.sku ? `&sku=${encodeURIComponent(this.data.sku)}` : ''}`
      : '';
    return {
      title: this.data.product && (this.data.product.name_zh || this.data.product.name) || 'RUDA 商品',
      path: `/pages/product/index${query ? `?${query}` : ''}`
    };
  },

  openStore() {
    const merchantId = this.data.product && this.data.product.merchantId;
    if (merchantId) wx.navigateTo({ url: `/pages/store/index?shopId=${encodeURIComponent(merchantId)}` });
  },

  openCart() {
    wx.navigateTo({ url: '/pages/cart/index' });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack({ delta: 1 });
    else wx.switchTab({ url: '/pages/home/index' });
  },

});
