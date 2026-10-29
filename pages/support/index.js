const { createSupportRequest } = require('../../utils/api');
const { getAuthSession } = require('../../utils/auth');

Page({
  data: {
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: '',
    submitting: false,
    error: ''
  },

  onLoad(options) {
    const draft = options.source === 'product' ? wx.getStorageSync('rudaProductSupportDraft') : null;
    if (options.source === 'product') wx.removeStorageSync('rudaProductSupportDraft');
    const profile = getAuthSession()?.profile || {};
    this.setData({
      name: profile.contactPerson || profile.companyName || profile.name || '',
      email: profile.email || '',
      phone: profile.phone || '',
      subject: draft && typeof draft.subject === 'string' ? draft.subject : '',
      message: draft && typeof draft.message === 'string' ? draft.message : ''
    });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!['name', 'email', 'phone', 'subject', 'message'].includes(field)) return;
    this.setData({ [field]: event.detail.value, error: '' });
  },

  async submitRequest() {
    if (this.data.submitting) return;
    const request = {
      name: this.data.name.trim(),
      email: this.data.email.trim(),
      phone: this.data.phone.trim(),
      subject: this.data.subject.trim(),
      message: this.data.message.trim()
    };
    if (!request.name || !request.subject || request.message.length < 10) {
      this.setData({ error: '请填写姓名、咨询主题和至少 10 个字的问题描述。' });
      return;
    }
    if (!request.email && !request.phone) {
      this.setData({ error: '请至少填写邮箱或联系电话，方便客服回复。' });
      return;
    }
    this.setData({ submitting: true, error: '' });
    try {
      const response = await createSupportRequest(request);
      if (!response || !response.request || !response.request.id) throw new Error('客服没有返回有效的请求编号。');
      wx.showModal({
        title: '客服留言已提交',
        content: 'RUDA 客服会通过你留下的联系方式回复。',
        showCancel: false,
        success: () => wx.navigateBack()
      });
    } catch (error) {
      const messages = {
        INVALID_SUPPORT_REQUEST: '请检查姓名、咨询主题和问题描述长度。',
        SUPPORT_CONTACT_REQUIRED: '请至少填写有效邮箱或联系电话。',
        TOO_MANY_REQUESTS: '提交次数过多，请稍后再试。'
      };
      this.setData({ error: messages[error && error.code] || error.message || '提交失败，请稍后重试。' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
