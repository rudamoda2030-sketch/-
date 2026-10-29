const {
  bindWechatIdentity,
  login,
  loginWithWechat,
  requestQuickBuyerRegistrationCode,
  verifyQuickBuyerRegistration
} = require('../../utils/api');
const { getAuthSession, saveAuthSession } = require('../../utils/auth');

const loginMessages = {
  EMAIL_PASSWORD_REQUIRED: '请输入账号和密码。',
  VALID_EMAIL_REQUIRED: '请输入正确的邮箱地址。',
  EMAIL_VERIFICATION_NOT_CONFIGURED: '邮箱验证服务暂不可用，请稍后再试。',
  EMAIL_DELIVERY_FAILED: '验证码发送失败，请稍后重试。',
  EMAIL_ALREADY_EXISTS: '该邮箱已注册，请直接登录。',
  VERIFICATION_CODE_REQUIRED: '请输入邮箱收到的验证码。',
  INVALID_OR_EXPIRED_CODE: '验证码错误或已过期，请重新获取。',
  PASSWORD_TOO_SHORT: '密码至少需要 8 位。',
  CONSENTS_REQUIRED: '请先阅读并同意用户协议和隐私政策。',
  BUYER_NOT_FOUND: '没有找到该买家账号。',
  MERCHANT_NOT_FOUND: '没有找到该商家账号。',
  EMPLOYEE_NOT_FOUND_OR_DISABLED: '员工账号不存在或已停用。',
  WRONG_PASSWORD: '密码不正确。',
  BUYER_PROFILE_REQUIRED: '该账号尚未完成买家资料。',
  MERCHANT_APPLICATION_REQUIRED: '该邮箱尚未关联已开通的商家账号。',
  MERCHANT_PENDING_REVIEW: '商家店铺尚未通过审核。',
  AUTH_RATE_LIMITED: '尝试次数过多，请稍后再试。',
  WECHAT_MINIPROGRAM_NOT_CONFIGURED: '微信登录服务暂未配置。',
  WECHAT_CODE_REQUIRED: '无法获取微信授权，请重试。',
  WECHAT_CODE_EXCHANGE_FAILED: '微信授权已失效，请重新点击微信登录。',
  WECHAT_CODE_EXCHANGE_UNAVAILABLE: '微信服务暂时不可用，请稍后重试。',
  WECHAT_PROVIDER_RESPONSE_INVALID: '微信服务暂时不可用，请稍后重试。',
  WECHAT_IDENTITY_ALREADY_BOUND: '此微信已绑定到其他 RUDA 买家账号。',
  BUYER_ACCOUNT_ALREADY_HAS_WECHAT_IDENTITY: '此 RUDA 买家账号已绑定其他微信。',
  BUYER_ACCOUNT_REQUIRED: '请先登录 RUDA 买家账号，再绑定微信。',
};

function getWechatLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(result) {
        if (typeof result.code === 'string' && result.code) resolve(result.code);
        else reject(Object.assign(new Error('WECHAT_CODE_REQUIRED'), { code: 'WECHAT_CODE_REQUIRED' }));
      },
      fail() {
        reject(Object.assign(new Error('WECHAT_CODE_REQUIRED'), { code: 'WECHAT_CODE_REQUIRED' }));
      }
    });
  });
}

Page({
  data: {
    selectedRole: 'buyer',
    registerMode: false,
    registerStep: 1,
    account: '',
    password: '',
    verificationCode: '',
    showPassword: false,
    acceptedLegal: false,
    acceptedTerms: false,
    acceptedPrivacy: false,
    codeSending: false,
    registrationCodeSent: false,
    merchantChoices: [],
    loading: false,
    error: '',
    wechatNeedsBinding: false,
    hasBuyerSession: false,
    returnTab: 'home'
  },

  onLoad(options) {
    if (options && ['merchants', 'settings', 'profile'].includes(options.returnTab)) {
      this.setData({ returnTab: options.returnTab });
    }
    if (options && ['buyer', 'merchant', 'employee'].includes(options.role)) {
      this.setData({ selectedRole: options.role, registerMode: false });
    }
    wx.setNavigationBarTitle({
      title: this.data.selectedRole === 'merchant'
        ? '商家登录'
        : this.data.selectedRole === 'employee' ? '员工登录' : '账号登录'
    });
    const session = getAuthSession();
    this.setData({ hasBuyerSession: Boolean(session && session.role === 'buyer') });
  },

  switchMode(event) {
    if (this.data.selectedRole !== 'buyer') return;
    this.setData({
      registerMode: event.currentTarget.dataset.mode === 'register',
      registerStep: 1,
      verificationCode: '',
      registrationCodeSent: false,
      showPassword: false,
      acceptedLegal: false,
      acceptedTerms: false,
      acceptedPrivacy: false,
      error: '',
      merchantChoices: [],
      wechatNeedsBinding: false
    });
  },

  onVerificationCodeInput(event) {
    this.setData({ verificationCode: event.detail.value });
  },

  async sendRegistrationCode() {
    if (this.data.loading || this.data.codeSending) return;
    const email = this.data.account.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.setData({ error: loginMessages.VALID_EMAIL_REQUIRED });
      return;
    }
    if (!this.data.acceptedLegal) {
      this.setData({ error: loginMessages.CONSENTS_REQUIRED });
      return;
    }
    this.setData({ codeSending: true, error: '' });
    try {
      await requestQuickBuyerRegistrationCode(email);
      this.setData({ registrationCodeSent: true, verificationCode: '' });
      wx.showToast({ title: '验证码已发送', icon: 'success' });
    } catch (error) {
      const code = error && error.code;
      this.setData({ error: loginMessages[code] || error.message || '验证码发送失败，请稍后重试。' });
    } finally {
      this.setData({ codeSending: false });
    }
  },

  onLegalConsentChange(event) {
    const checked = event.detail.value || [];
    const acceptedTerms = checked.includes('terms');
    const acceptedPrivacy = checked.includes('privacy');
    this.setData({
      acceptedTerms,
      acceptedPrivacy,
      acceptedLegal: acceptedTerms && acceptedPrivacy
    });
  },

  onAccountInput(event) {
    this.setData({
      account: event.detail.value,
      registrationCodeSent: false,
      verificationCode: ''
    });
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value });
  },

  togglePasswordVisibility() {
    this.setData({ showPassword: !this.data.showPassword });
  },

  goToRegistration() {
    this.setData({
      selectedRole: 'buyer',
      registerMode: true,
      registerStep: 1,
      verificationCode: '',
      registrationCodeSent: false,
      showPassword: false,
      acceptedLegal: false,
      acceptedTerms: false,
      acceptedPrivacy: false,
      error: '',
      merchantChoices: []
    });
    wx.setNavigationBarTitle({ title: '邮箱注册' });
  },

  goToLogin() {
    this.switchMode({ currentTarget: { dataset: { mode: 'login' } } });
    wx.setNavigationBarTitle({
      title: this.data.selectedRole === 'merchant'
        ? '商家登录'
        : this.data.selectedRole === 'employee' ? '员工登录' : '账号登录'
    });
  },

  async onSubmit() {
    if (this.data.registerMode) {
      if (this.data.registerStep === 1) {
        await this.continueRegistration();
        return;
      }
      await this.registerBuyer();
      return;
    }
    await this.authenticate();
  },

  async continueRegistration() {
    const email = this.data.account.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.setData({ error: loginMessages.VALID_EMAIL_REQUIRED });
      return;
    }
    if (this.data.password.length < 8) {
      this.setData({ error: loginMessages.PASSWORD_TOO_SHORT });
      return;
    }
    if (!this.data.acceptedLegal) {
      this.setData({ error: loginMessages.CONSENTS_REQUIRED });
      return;
    }
    if (!this.data.registrationCodeSent) {
      this.setData({ error: '请先验证邮箱并获取验证码。' });
      return;
    }
    this.setData({ registerStep: 2, error: '' });
  },

  async registerBuyer() {
    if (this.data.loading) return;
    const email = this.data.account.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.setData({ error: loginMessages.VALID_EMAIL_REQUIRED });
      return;
    }
    if (!this.data.verificationCode.trim()) {
      this.setData({ error: loginMessages.VERIFICATION_CODE_REQUIRED });
      return;
    }
    if (this.data.password.length < 8) {
      this.setData({ error: loginMessages.PASSWORD_TOO_SHORT });
      return;
    }
    if (!this.data.acceptedLegal) {
      this.setData({ error: loginMessages.CONSENTS_REQUIRED });
      return;
    }

    this.setData({ loading: true, error: '' });
    try {
      await verifyQuickBuyerRegistration(
        email,
        this.data.verificationCode.trim(),
        this.data.password,
        this.data.acceptedLegal
      );
      const response = await login('buyer', { email, password: this.data.password });
      saveAuthSession('buyer', response);
      wx.showToast({ title: '注册成功', icon: 'success' });
      this.returnFromLogin();
    } catch (error) {
      const code = error && error.code;
      this.setData({ error: loginMessages[code] || error.message || '注册失败，请稍后重试。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  returnToRegistrationDetails() {
    this.setData({ registerStep: 1, error: '' });
  },

  async onWechatLogin() {
    if (this.data.loading || this.data.selectedRole !== 'buyer') return;
    this.setData({ loading: true, error: '' });
    try {
      const code = await getWechatLoginCode();
      const response = await loginWithWechat(code);
      if (response.requiresAccountBinding) {
        this.setData({
          wechatNeedsBinding: true,
          error: '此微信尚未绑定 RUDA 买家账号。请先使用账号密码登录，再确认绑定。'
        });
        return;
      }
      saveAuthSession('buyer', response);
      this.returnFromLogin();
    } catch (error) {
      const code = error && error.code;
      this.setData({
        error: loginMessages[code] || (error && error.message) || '微信登录失败，请稍后重试。'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  onBindWechat() {
    const session = getAuthSession();
    if (!session || session.role !== 'buyer' || this.data.loading) return;
    this.confirmWechatBinding();
  },

  confirmWechatBinding() {
    wx.showModal({
      title: '绑定微信快捷登录',
      content: '将当前微信绑定到这个 RUDA 买家账号。绑定仅用于买家登录，不会授予商家权限。',
      confirmText: '确认绑定',
      cancelText: '暂不',
      success: result => {
        if (result.confirm) {
          void this.bindWechatForCurrentAccount();
        } else {
          this.returnFromLogin();
        }
      },
      fail: () => this.returnFromLogin()
    });
  },

  async bindWechatForCurrentAccount() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const code = await getWechatLoginCode();
      const result = await bindWechatIdentity(code);
      wx.showToast({ title: result.alreadyBound ? '微信已绑定' : '绑定成功', icon: 'success' });
      this.returnFromLogin();
    } catch (error) {
      const code = error && error.code;
      this.setData({
        error: loginMessages[code] || (error && error.message) || '微信绑定失败，请稍后重试。'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  async selectMerchant(event) {
    const merchantId = event.currentTarget.dataset.id;
    if (merchantId) await this.authenticate(merchantId);
  },

  async authenticate(merchantId) {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const role = this.data.selectedRole;
      const credentials = { password: this.data.password };
      if (role === 'employee') {
        credentials.email = this.data.account.trim();
        if (merchantId) credentials.merchantId = merchantId;
      } else if (role === 'buyer') {
        const account = this.data.account.trim();
        credentials[account.includes('@') ? 'email' : 'phone'] = account;
      } else {
        const account = this.data.account.trim();
        if (account.includes('@')) credentials.email = account;
        else if (/^[+\d\s().-]{6,}$/.test(account)) credentials.phone = account;
        else credentials.code = account;
      }

      const response = await login(role, credentials);
      if (response.requiresMerchantSelection) {
        this.setData({ merchantChoices: response.merchants || [] });
        return;
      }
      saveAuthSession(role, response);
      if (role === 'buyer') {
        this.setData({ hasBuyerSession: true });
        if (this.data.wechatNeedsBinding) {
          this.setData({ wechatNeedsBinding: false });
          this.confirmWechatBinding();
          return;
        }
        this.returnFromLogin();
      } else {
        wx.redirectTo({ url: '/pages/merchant/index' });
      }
    } catch (error) {
      const code = error && error.code;
      this.setData({
        error: loginMessages[code] || (error && error.message) || '登录失败，请稍后重试。'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  returnFromLogin() {
    if (this.data.returnTab === 'settings') {
      wx.navigateBack({ delta: 1 });
      return;
    }
    if (this.data.returnTab === 'profile') {
      wx.switchTab({ url: '/pages/profile/index' });
      return;
    }
    const tab = this.data.returnTab === 'merchants' ? 'merchants' : 'home';
    wx.switchTab({ url: `/pages/${tab}/index` });
  }
});
