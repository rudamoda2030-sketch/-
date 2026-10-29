const { createMerchantProduct, presignMerchantMedia } = require('../../utils/api');

const categories = [
  { value: 'tops', label: '上衣' },
  { value: 'pants', label: '裤子' },
  { value: 'skirts', label: '裙子' }
];

function createRequestKey() {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function contentTypeForPath(path) {
  const extension = String(path).split('?')[0].split('.').pop().toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function readFile(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success: result => resolve(result.data),
      fail: () => reject(new Error('无法读取所选图片，请重新选择。'))
    });
  });
}

function uploadFile(uploadUrl, filePath, contentType) {
  return readFile(filePath).then(data => new Promise((resolve, reject) => {
    wx.request({
      url: uploadUrl,
      method: 'PUT',
      data,
      header: { 'Content-Type': contentType },
      timeout: 30000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve();
        else reject(new Error(`图片上传失败（${response.statusCode}），请稍后重试。`));
      },
      fail() {
        reject(new Error('图片上传失败，请检查网络或联系管理员确认对象存储域名。'));
      }
    });
  }));
}

Page({
  data: {
    categories,
    categoryIndex: 0,
    category: 'tops',
    name: '',
    styleNo: '',
    wholesalePrice: '',
    wholesalePrice100: '',
    rrpPrice: '',
    moq: '1',
    color: '',
    size: '',
    sku: '',
    stock: '0',
    imagePath: '',
    loading: false,
    error: ''
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    const allowed = ['name', 'styleNo', 'wholesalePrice', 'wholesalePrice100', 'rrpPrice', 'moq', 'color', 'size', 'sku', 'stock'];
    if (allowed.includes(field)) this.setData({ [field]: event.detail.value, error: '' });
  },

  onCategoryChange(event) {
    const categoryIndex = Number(event.detail.value);
    const category = categories[categoryIndex];
    if (category) this.setData({ categoryIndex, category: category.value });
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: result => {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file || !file.tempFilePath) return;
        if (file.size > 10 * 1024 * 1024) {
          this.setData({ error: '图片不能超过 10 MB。' });
          return;
        }
        this._uploadedMedia = null;
        this._imageSize = file.size;
        this.setData({ imagePath: file.tempFilePath, error: '' });
      },
      fail: result => {
        if (result && result.errMsg && result.errMsg.includes('cancel')) return;
        this.setData({ error: '无法选择图片，请检查小程序相册/相机权限。' });
      }
    });
  },

  async submit() {
    if (this.data.loading) return;
    const wholesalePrice = Number(this.data.wholesalePrice);
    const wholesalePrice100 = this.data.wholesalePrice100.trim()
      ? Number(this.data.wholesalePrice100)
      : null;
    const rrpPrice = Number(this.data.rrpPrice);
    const moq = Number(this.data.moq);
    const stock = Number(this.data.stock);
    if (!this.data.name.trim() || !this.data.styleNo.trim() || !this.data.category
      || !this.data.color.trim() || !this.data.size.trim() || !this.data.sku.trim()
      || !this.data.imagePath || !Number.isFinite(wholesalePrice) || wholesalePrice <= 0
      || !Number.isFinite(rrpPrice) || rrpPrice <= 0
      || !Number.isInteger(moq) || moq < 1 || !Number.isInteger(stock) || stock < 0
      || (wholesalePrice100 !== null
        && (!Number.isFinite(wholesalePrice100) || wholesalePrice100 <= 0 || wholesalePrice100 > wholesalePrice))) {
      this.setData({ error: '请填写完整商品、主图和 SKU 信息。价格须大于 0，起订量至少为 1，库存不得为负数。' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      if (!this._uploadedMedia) {
        const contentType = contentTypeForPath(this.data.imagePath);
        const upload = await presignMerchantMedia(contentType, this._imageSize);
        if (!upload.uploadUrl || !upload.publicUrl || !upload.key) throw new Error('图片上传地址配置异常。');
        if (!/^https:\/\//i.test(upload.uploadUrl) || !/^https:\/\//i.test(upload.publicUrl)) {
          throw new Error('图片上传与访问地址必须使用 HTTPS。');
        }
        await uploadFile(upload.uploadUrl, this.data.imagePath, contentType);
        this._uploadedMedia = {
          url: upload.publicUrl,
          storageKey: upload.key,
          contentType: upload.contentType,
          sizeBytes: upload.sizeBytes
        };
      }
      if (!this._creationRequestKey) this._creationRequestKey = createRequestKey();
      await createMerchantProduct({
        creationRequestKey: this._creationRequestKey,
        name: this.data.name.trim(),
        styleNo: this.data.styleNo.trim(),
        category: this.data.category,
        wholesalePrice,
        wholesalePrice100,
        rrpPrice,
        moq,
        packSize: 1,
        bulkPriceMinimumQuantity: 100,
        visibility: 'public',
        lifecycleStatus: 'draft',
        media: [{
          id: 'main-image',
          type: 'image',
          role: 'main',
          url: this._uploadedMedia.url,
          storageKey: this._uploadedMedia.storageKey,
          contentType: this._uploadedMedia.contentType,
          sizeBytes: this._uploadedMedia.sizeBytes,
          source: 'merchant-upload'
        }],
        skus: [{
          sku: this.data.sku.trim(),
          color: this.data.color.trim(),
          size: this.data.size.trim(),
          stockCentral: stock,
          isActive: true
        }]
      });
      this._creationRequestKey = '';
      this._uploadedMedia = null;
      wx.showToast({ title: '商品草稿已创建', icon: 'success' });
      wx.navigateBack();
    } catch (error) {
      this.setData({ error: error.message || '创建商品失败，请检查权限和对象存储配置。' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
