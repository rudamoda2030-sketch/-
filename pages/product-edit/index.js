const { getMerchantProducts, updateMerchantProduct } = require('../../utils/api');

Page({
  data: {
    productId: '',
    name: '',
    styleNo: '',
    category: '',
    wholesalePrice: '',
    wholesalePrice100: '',
    rrpPrice: '',
    moq: '',
    description: '',
    loaded: false,
    loading: false,
    saving: false,
    error: ''
  },

  async onLoad(options) {
    const productId = typeof options.productId === 'string' ? options.productId : '';
    if (!productId) {
      this.setData({ error: '缺少商品编号。' });
      return;
    }
    this.setData({ productId, loading: true });
    try {
      const response = await getMerchantProducts();
      const product = (response.products || []).find(item => item.id === productId);
      if (!product) throw new Error('没有找到该商家商品或当前账号无权查看。');
      this.setData({
        name: product.name || '',
        styleNo: product.styleNo || '',
        category: product.category || '',
        wholesalePrice: String(product.wholesalePrice ?? ''),
        wholesalePrice100: product.wholesalePrice100 == null ? '' : String(product.wholesalePrice100),
        rrpPrice: String(product.rrpPrice ?? ''),
        moq: String(product.moq ?? 1),
        description: product.description || '',
        loaded: true
      });
    } catch (error) {
      this.setData({ error: error.message || '商品资料加载失败。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    const allowed = ['name', 'styleNo', 'category', 'wholesalePrice', 'wholesalePrice100', 'rrpPrice', 'moq', 'description'];
    if (allowed.includes(field)) {
      this.setData({ [field]: event.detail.value, error: '' });
    }
  },

  async save() {
    if (this.data.saving || !this.data.loaded || !this.data.productId) return;
    const wholesalePrice = Number(this.data.wholesalePrice);
    const rrpPrice = Number(this.data.rrpPrice);
    const moq = Number(this.data.moq);
    const wholesalePrice100 = this.data.wholesalePrice100.trim() === ''
      ? null
      : Number(this.data.wholesalePrice100);
    if (!this.data.name.trim() || !this.data.styleNo.trim() || !this.data.category.trim()
      || !Number.isFinite(wholesalePrice) || wholesalePrice <= 0
      || !Number.isFinite(rrpPrice) || rrpPrice <= 0
      || !Number.isInteger(moq) || moq < 1
      || (wholesalePrice100 !== null
        && (!Number.isFinite(wholesalePrice100) || wholesalePrice100 <= 0 || wholesalePrice100 > wholesalePrice))) {
      this.setData({ error: '请检查商品名称、款号、分类、价格和起订量；批量价不能高于基础价。' });
      return;
    }
    this.setData({ saving: true, error: '' });
    try {
      await updateMerchantProduct(this.data.productId, {
        name: this.data.name.trim(),
        styleNo: this.data.styleNo.trim(),
        category: this.data.category.trim(),
        wholesalePrice,
        wholesalePrice100,
        rrpPrice,
        moq,
        description: this.data.description.trim()
      });
      wx.showToast({ title: '商品资料已保存', icon: 'success' });
      wx.navigateBack();
    } catch (error) {
      this.setData({ error: error.message || '商品保存失败，请检查账号权限。' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
