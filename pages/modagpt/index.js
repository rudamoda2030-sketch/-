const { getMiniProgramFeatures, postModaGptMessage } = require('../../utils/api');

const starterPrompts = [
  '设计一款春季女装',
  '分析今年的时尚趋势',
  '为胶囊系列规划配色',
  '帮我完善服装设计方案'
];

Page({
  data: {
    messages: [],
    input: '',
    busy: false,
    error: '',
    starterPrompts,
    featureEnabled: false,
    tryOnEnabled: false
  },

  async onShow() {
    try {
      const result = await getMiniProgramFeatures();
      const enabled = Boolean(result && result.features && result.features.aiSectionEnabled === true);
      this.setData({ featureEnabled: enabled });
      if (!enabled) {
        wx.showToast({ title: 'AI 版块暂未开放', icon: 'none' });
        wx.switchTab({ url: '/pages/home/index' });
        return;
      }
      const tabBar = this.getTabBar && this.getTabBar();
      if (tabBar) tabBar.setData({ selected: 2 });
    } catch (error) {
      console.error('[modagpt-features]', error);
      this.setData({ featureEnabled: false });
      wx.showToast({ title: 'AI 版块暂不可用', icon: 'none' });
      wx.switchTab({ url: '/pages/home/index' });
    }
  },

  onInput(event) {
    this.setData({ input: event.detail.value });
  },

  async sendMessage(event) {
    if (!this.data.featureEnabled) return;
    const prompt = (event && event.currentTarget && event.currentTarget.dataset.prompt) || this.data.input;
    const message = typeof prompt === 'string' ? prompt.trim() : '';
    if (!message || this.data.busy) return;

    const history = this.data.messages.slice(-6).map(item => ({
      role: item.role,
      text: item.text
    }));
    this.setData({
      messages: [...this.data.messages, { role: 'user', text: message }],
      input: '',
      busy: true,
      error: ''
    });

    try {
      const response = await postModaGptMessage(message, history);
      this.setData({
        messages: [...this.data.messages, { role: 'assistant', text: response.reply }]
      });
    } catch (error) {
      const messageText = error.code === 'MODAGPT_SENSITIVE_PROMPT_BLOCKED'
        ? '请勿发送个人联系方式、证件、银行卡或密码等敏感信息。'
        : '暂时无法连接 ModaUI，请稍后重试。';
      this.setData({ error: messageText });
    } finally {
      this.setData({ busy: false });
    }
  },

  openTryOn() {
    if (!this.data.featureEnabled) return;
    wx.navigateTo({ url: '/pages/tryon/index' });
  }
});
