Page({
  data: {
    url: '',
    loadError: false
  },

  onLoad(options) {
    const url = typeof options.url === 'string' ? options.url : '';
    const title = typeof options.title === 'string' ? options.title : '官方网站';
    if (!/^https?:\/\/[^/\s?#]+(?:[/?#][^\s]*)?$/i.test(url) || url.length > 2000) {
      wx.showToast({ title: '官网链接无效', icon: 'none' });
      return;
    }
    wx.setNavigationBarTitle({ title });
    this.setData({ url, loadError: false });
  },

  onWebViewError() {
    this.setData({ loadError: true });
  },

  copyWebsite() {
    if (!this.data.url) return;
    wx.setClipboardData({
      data: this.data.url,
      success: () => wx.showToast({ title: '官网链接已复制', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
    });
  }
});
