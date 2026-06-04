class WhatsAppBOTApp {
  constructor() {
    this.state = {
      apiReady: false,
      isConnected: false,
      isConnecting: false,
      hasSession: false,
      sessionInfo: null,
      currentTab: 'messaging',
      messageType: 'single',
      singleScheduleMode: 'now',
      singleMessageType: 'text',
      singleMediaList: [],
      bulkMediaList: []
    };
  }

  async init() {
    try {
      await api.init();
      await this.loadTheme();
      this.setupEventListeners();
      utils.initTooltips();
      await this.loadSettings();
      await this.restoreLastUsed();

      // Hiç sunucu yapılandırılmadıysa: hiçbir istek atma (gereksiz /auth/status
      // polling'i önlenir), kullanıcıyı sunucu eklemeye yönlendir.
      if (!api.baseUrl) {
        this.state.apiReady = false;
        this.state.isConnected = false;
        this.state.isConnecting = false;
        this.updateConnectionUI();
        this.updateSidebarLock();
        this.updateApiStatusDot('');
        this.showConnectionOverlay();
        this.hideLoadingScreen();
        this.startAutoRefresh();
        setTimeout(() => this.openApiModal('add-server'), 400);
        return;
      }

      try {
        await this.checkConnection();
        this.state.apiReady = true;
        this.updateSidebarLock();

        if (this.state.isConnected) {
          this.hideConnectionOverlay();
          this.switchTab('messaging');
          this.updateApiStatusDot('connected');
        } else {
          this.showConnectionOverlay();
          this.updateApiStatusDot('connected');

          if (this.state.isConnecting) {
            this.connect();
          }
        }
      } catch (connectionError) {
        console.error('Initial connection check failed:', connectionError);
        this.state.apiReady = false;
        this.state.isConnected = false;
        this.state.isConnecting = false;
        this.updateConnectionUI();
        this.updateSidebarLock();
        this.updateApiStatusDot('error');
        this.showConnectionOverlay();
        setTimeout(() => this.openApiModal(), 600);
      }

      this.hideLoadingScreen();
      this.startAutoRefresh();
    } catch (error) {
      console.error('Init error:', error);
      this.updateLoadingStatus('Bağlantı hatası');
      setTimeout(() => {
        this.hideLoadingScreen();
        this.state.apiReady = false;
        this.updateSidebarLock();
        this.updateApiStatusDot('');
        this.showConnectionOverlay();
        setTimeout(() => this.openApiModal(), 300);
      }, 1500);
    }
  }

  hideLoadingScreen() {
    const loading = document.getElementById('loading-screen');
    const app = document.getElementById('app');
    loading.classList.add('fade-out');
    app.classList.remove('hidden');
    setTimeout(() => loading.style.display = 'none', 300);
  }

  updateLoadingStatus(text) {
    const el = document.querySelector('.loading-status');
    if (el) el.textContent = text;
  }

  async loadSettings() {
    const settings = await api.getSettings();
    document.getElementById('api-url').value = settings.apiUrl;
    document.getElementById('api-key').value = settings.apiKey;
  }

  setupEventListeners() {
    document.querySelectorAll('.sidebar-nav-item[data-tab]').forEach(item => {
      item.addEventListener('click', () => this.switchTab(item.dataset.tab));
    });

    document.getElementById('theme-toggle')?.addEventListener('click', () => this.toggleTheme());

    document.getElementById('sidebar-api-settings')?.addEventListener('click', () => this.openApiModal());

    document.getElementById('api-settings-trigger')?.addEventListener('click', () => this.openApiModal());
    document.getElementById('api-modal-close')?.addEventListener('click', () => this.closeApiModal());
    document.getElementById('api-modal-backdrop')?.addEventListener('click', () => this.closeApiModal());
    document.getElementById('save-settings')?.addEventListener('click', () => this.saveSettings());
    document.getElementById('test-connection')?.addEventListener('click', () => this.testConnection());
    document.getElementById('toggle-api-key')?.addEventListener('click', () => this.toggleApiKeyVisibility());

    document.querySelectorAll('.modal-tab[data-modal-tab]').forEach(tab => {
      tab.addEventListener('click', () => this.switchModalTab(tab.dataset.modalTab));
    });

    document.getElementById('save-server-settings')?.addEventListener('click', () => this.saveServerSettings());
    document.getElementById('refresh-server-settings')?.addEventListener('click', () => this.loadServerSettings());
    document.getElementById('retry-server-settings')?.addEventListener('click', () => this.loadServerSettings());

    document.getElementById('terminal-log-btn')?.addEventListener('click', () => this.openTerminalPopup());
    document.getElementById('terminal-close-btn')?.addEventListener('click', () => this.closeTerminalPopup());
    document.getElementById('terminal-clear-btn')?.addEventListener('click', () => this.clearTerminalOutput());
    document.getElementById('terminal-scroll-btn')?.addEventListener('click', () => {
      const output = document.getElementById('terminal-output');
      if (output) output.scrollTop = output.scrollHeight;
    });

    // Yazıyor süresi etiketi (değer "Ayarları Kaydet" ile sunucuya yazılır)
    document.getElementById('typing-duration')?.addEventListener('input', (e) => {
      const sec = parseInt(e.target.value);
      const label = document.getElementById('typing-duration-value');
      if (label) label.textContent = sec === 0 ? 'Kapalı' : `${sec} sn`;
    });

    document.getElementById('enc-alert-reconnect')?.addEventListener('click', () => this.reconnectEncryption());

    document.getElementById('connect-btn').addEventListener('click', () => this.connect());
    document.getElementById('disconnect-btn').addEventListener('click', () => this.disconnect());

    document.getElementById('pairing-toggle-btn')?.addEventListener('click', () => this.enterPairingMode());
    document.getElementById('pairing-back-btn')?.addEventListener('click', () => this.exitPairingMode());
    document.getElementById('pairing-code-btn')?.addEventListener('click', () => this.requestPairingCode());
    document.getElementById('pairing-phone')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.requestPairingCode();
    });

    document.getElementById('refresh-stats')?.addEventListener('click', () => this.loadStats());

    document.querySelectorAll('.messaging-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchMessageType(tab.dataset.type));
    });

    document.querySelectorAll('.schedule-option').forEach(opt => {
      opt.addEventListener('click', () => this.setScheduleMode(opt.dataset.schedule));
    });
    document.querySelectorAll('.type-option[data-type]').forEach(opt => {
      opt.addEventListener('click', () => this.setSingleMessageType(opt.dataset.type));
    });
    document.getElementById('single-send-btn').addEventListener('click', () => this.handleSingleSend());
    document.getElementById('single-message').addEventListener('input', (e) => {
      const counter = document.getElementById('single-char-count');
      if (counter) counter.textContent = e.target.value.length;
    });

    const datetimeInput = document.getElementById('single-datetime');
    if (datetimeInput) {
      datetimeInput.min = utils.getMinScheduleDate();
      datetimeInput.addEventListener('focus', () => {
        datetimeInput.min = utils.getMinScheduleDate();
      });
    }

    document.querySelectorAll('.type-option[data-bulk-type]').forEach(opt => {
      opt.addEventListener('click', () => this.setBulkMessageType(opt.dataset.bulkType));
    });
    document.getElementById('bulk-recipients').addEventListener('input', (e) => this.updateRecipientCount(e.target.value));
    document.getElementById('bulk-message').addEventListener('input', (e) => this.updateBulkCharCount(e.target.value));

    document.querySelectorAll('.schedule-option[data-bulk-schedule]').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('.schedule-option[data-bulk-schedule]').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        const isLater = opt.dataset.bulkSchedule === 'later';
        document.getElementById('bulk-schedule-enabled').checked = isLater;
        utils.toggle('bulk-schedule-datetime', isLater);
        if (isLater) {
          const datetimeInput = document.getElementById('bulk-start-datetime');
          if (datetimeInput) {
            datetimeInput.min = utils.getMinScheduleDate();
            const defaultDate = new Date();
            defaultDate.setHours(defaultDate.getHours() + 1);
            defaultDate.setMinutes(0);
            datetimeInput.value = utils.toLocalISOString(defaultDate);
          }
        }
      });
    });

    document.getElementById('bulk-start-datetime')?.addEventListener('focus', (e) => {
      e.target.min = utils.getMinScheduleDate();
    });
    document.getElementById('bulk-send-btn').addEventListener('click', () => this.handleBulkSend());

    // Medya sürükle-bırak (Task 2)
    this.setupDropzone('single');
    this.setupDropzone('bulk');

    // Geçersiz numara popup'ı kapat (Task 1)
    document.getElementById('invalid-ok-btn')?.addEventListener('click', () => this.closeInvalidPopup());
    document.getElementById('invalid-backdrop')?.addEventListener('click', () => this.closeInvalidPopup());
  }

  switchTab(tabId) {
    if (!this.state.apiReady) {
      utils.toast('Önce API bağlantısını yapılandırın', 'warning');
      return;
    }

    if (!this.state.isConnected) {
      utils.toast('WhatsApp bağlı değil. Önce bağlantı kurun.', 'warning');
      return;
    }

    document.querySelectorAll('.sidebar-nav-item[data-tab]').forEach(item => {
      item.classList.toggle('active', item.dataset.tab === tabId);
    });

    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.classList.toggle('active', tab.id === `tab-${tabId}`);
    });

    const titles = {
      'messaging': 'Mesaj Gönderimi',
      'dashboard': 'Kontrol Paneli'
    };
    document.getElementById('page-title').textContent = titles[tabId] || tabId;

    this.state.currentTab = tabId;

    switch (tabId) {
      case 'messaging':
        this.loadBulkJobs();
        this.loadScheduledMessages();
        break;
      case 'dashboard':
        this.loadDashboardData();
        break;
    }
  }

  async checkConnection() {
    try {
      this.updateLoadingStatus('Bağlantı kontrol ediliyor...');
      const response = await api.getStatus();

      if (response.success && response.data) {
        this.state.isConnected = response.data.isConnected;
        this.state.isConnecting = response.data.isConnecting || false;
        this.state.sessionInfo = response.data.session;
        this.state.hasSession = response.data.hasSession || false;
        this.updateConnectionUI();
        this.updateEncryptionAlert(response.data.encryptionAlert);

        if (this.state.isConnected) {
          await this.loadDashboardData();
        } else if (response.data.hasSession && !response.data.isConnecting) {
          this.updateLoadingStatus('Kayıtlı oturum bulundu, bağlanıyor...');

          await new Promise(resolve => setTimeout(resolve, 3000));

          const retryResponse = await api.getStatus();
          if (retryResponse.success && retryResponse.data) {
            this.state.isConnected = retryResponse.data.isConnected;
            this.state.isConnecting = retryResponse.data.isConnecting || false;
            this.state.sessionInfo = retryResponse.data.session;
            this.updateConnectionUI();

            if (retryResponse.data.isConnected) {
              await this.loadDashboardData();
            } else if (retryResponse.data.isConnecting) {
              this.updateLoadingStatus('Bağlanıyor...');
            }
          }
        } else if (response.data.isConnecting) {
          this.updateLoadingStatus('Bağlanıyor...');
        }
      }
    } catch (error) {
      console.error('Connection check error:', error);
      this.state.isConnected = false;
      this.state.isConnecting = false;
      this.updateConnectionUI();
      throw error;
    }
  }

  updateConnectionUI() {
    const { isConnected, isConnecting, sessionInfo } = this.state;

    const badge = document.getElementById('connection-status');
    const badgeText = badge.querySelector('.badge-text');
    badge.classList.remove('connected', 'connecting', 'disconnected');

    if (isConnected) {
      badge.classList.add('connected');
      badgeText.textContent = 'Bağlı';
    } else if (isConnecting) {
      badge.classList.add('connecting');
      badgeText.textContent = 'Bağlanıyor...';

      const connectBtn = document.getElementById('connect-btn');
      if (connectBtn && !connectBtn.disabled) {
        connectBtn.disabled = true;
        connectBtn.innerHTML = '<span class="spinner"></span> Bağlanıyor...';
      }
    } else {
      badge.classList.add('disconnected');
      badgeText.textContent = 'Bağlı Değil';

      this.resetConnectButton();
    }

    if (isConnected) {
      this.hideConnectionOverlay();
    } else {
      this.showConnectionOverlay();
    }

    const connectedView = document.getElementById('dashboard-connected-view');
    const qrPlaceholder = document.getElementById('qr-placeholder');
    const qrImage = document.getElementById('qr-image');

    if (isConnected) {
      utils.show(connectedView);

      if (sessionInfo) {
        document.getElementById('session-name').textContent = sessionInfo.name || 'WhatsApp Kullanıcısı';
        document.getElementById('session-phone').textContent = utils.formatPhone(sessionInfo.phone);
      }

      this.updateApiInfoDisplay();
      this.updateApiStatusDot('connected');

      this.loadServerSettings();
    } else {
      utils.hide(connectedView);

      if (!isConnecting) {
        utils.show(qrPlaceholder);
        qrImage.classList.add('hidden');
        qrImage.src = '';
      }
    }

    this.updateSidebarLock();
  }

  async connect() {
    const servers = await this.getSavedServers();
    if (servers.length === 0 && !this.state.apiReady) {
      utils.toast('Önce bir sunucu eklemeniz gerekiyor', 'warning');
      this.openApiModal('add-server');
      return;
    }

    let preCheckStatus = null;
    try {
      const preCheckResponse = await api.getStatus();
      if (preCheckResponse.success && preCheckResponse.data) {
        preCheckStatus = preCheckResponse.data;
        this.state.apiReady = true;
        this.updateApiStatusDot('connected');

        if (preCheckStatus.isConnected) {
          this.state.isConnected = true;
          this.state.isConnecting = false;
          this.state.sessionInfo = preCheckStatus.session;
          this.state.hasSession = true;
          this.updateConnectionUI();
          this.hideConnectionOverlay();
          this.switchTab('messaging');
          utils.toast('WhatsApp zaten bağlı!', 'success');
          this.loadDashboardData();
          return;
        }
      }
    } catch (preCheckError) {
      console.error('Server pre-check failed:', preCheckError);
      utils.toast('Sunucuya erişilemiyor. Sunucu bağlantı ayarlarını kontrol edin.', 'error');
      this.state.apiReady = false;
      this.updateApiStatusDot('error');
      return;
    }

    try {
      this.state.isConnecting = true;
      this.state.isConnected = false;
      this.updateConnectionUI();
      utils.toast('QR kod alınıyor...', 'info');

      const connectBtn = document.getElementById('connect-btn');
      connectBtn.disabled = true;
      connectBtn.innerHTML = '<span class="spinner"></span> Bağlanıyor...';

      let connectionReceived = false;
      let stabilizationCheckTimer = null;

      api.startQRStream(
        (qrCode) => {
          const qrImg = document.getElementById('qr-image');
          const qrPlaceholder = document.getElementById('qr-placeholder');
          qrImg.src = qrCode;
          qrImg.classList.remove('hidden');
          utils.hide(qrPlaceholder);

          this.state.isConnecting = true;
          this.state.isConnected = false;
        },
        async (session) => {
          console.log('QR Stream connected event received:', session);
          connectionReceived = true;

          this.state.isConnecting = true;
          this.state.isConnected = false;
          this.state.sessionInfo = session;

          const connectBtn = document.getElementById('connect-btn');
          if (connectBtn) {
            connectBtn.disabled = true;
            connectBtn.innerHTML = '<span class="spinner"></span> Senkronize ediliyor...';
          }

          utils.toast('WhatsApp senkronize ediliyor, lütfen bekleyin...', 'info');

          const checkStability = async (attempt = 1) => {
            try {
              const statusResponse = await api.getStatus();
              if (statusResponse.success && statusResponse.data) {
                if (statusResponse.data.isConnected) {
                  this.state.isConnecting = false;
                  this.state.isConnected = true;
                  this.state.sessionInfo = statusResponse.data.session || session;
                  this.state.hasSession = true;

                  this.resetConnectButton();
                  this.updateConnectionUI();
                  utils.toast('WhatsApp bağlandı!', 'success');

                  this.loadDashboardData();
                  return true;
                } else if (statusResponse.data.isConnecting && attempt < 6) {
                  console.log(`Still connecting, attempt ${attempt}/6, checking again in 3s...`);
                  setTimeout(() => checkStability(attempt + 1), 3000);
                  return false;
                } else {
                  console.log('Connection failed after multiple checks');
                  this.state.isConnecting = false;
                  this.state.isConnected = false;
                  this.resetConnectButton();
                  this.updateConnectionUI();
                  utils.toast('Bağlantı kurulamadı, tekrar deneyin', 'error');
                  return false;
                }
              }
            } catch (error) {
              console.error('Status check failed:', error);
              if (attempt < 6) {
                setTimeout(() => checkStability(attempt + 1), 3000);
              } else {
                this.state.isConnecting = false;
                this.resetConnectButton();
                this.updateConnectionUI();
              }
            }
            return false;
          };

          stabilizationCheckTimer = setTimeout(() => checkStability(1), 3000);
        },
        (error) => {
          console.error('QR Stream error:', error);
          if (!connectionReceived) {
            this.state.isConnecting = false;
            this.state.isConnected = false;
            this.updateConnectionUI();
            this.resetConnectButton();
            utils.toast(error.message || 'Bağlantı hatası', 'error');
          }
        },
        (reason) => {
          console.log('QR Stream disconnected:', reason);

          if (connectionReceived && this.state.isConnecting) {
            console.log('Ignoring disconnect during stabilization');
            return;
          }

          this.state.isConnecting = false;
          this.state.isConnected = false;
          this.updateConnectionUI();
          this.resetConnectButton();

          if (reason && reason !== 'Connection cancelled by user') {
            api.getStatus().then(response => {
              if (response.success && response.data?.isConnected) {
                this.state.isConnected = true;
                this.state.sessionInfo = response.data.session;
                this.updateConnectionUI();
                utils.toast('WhatsApp bağlandı!', 'success');
              } else {
                utils.toast('Bağlantı kesildi: ' + reason, 'warning');
              }
            }).catch(() => {
              utils.toast('Bağlantı kesildi: ' + reason, 'warning');
            });
          }
        },
        () => {
          console.log('QR Stream timeout');
          this.state.isConnecting = false;
          this.updateConnectionUI();
          this.resetConnectButton();
          utils.toast('QR kod süresi doldu. Tekrar deneyin.', 'warning');
        },
        (data) => {
          console.log('QR Stream reconnecting:', data);
          this.state.isConnecting = true;
          this.state.isConnected = false;

          const connectBtn = document.getElementById('connect-btn');
          if (connectBtn) {
            connectBtn.disabled = true;
            connectBtn.innerHTML = `<span class="spinner"></span> Yeniden bağlanıyor (${data.attempt})...`;
          }

          const qrPlaceholder = document.getElementById('qr-placeholder');
          if (qrPlaceholder) {
            qrPlaceholder.innerHTML = `
              <span class="spinner"></span>
              <p>Yeniden bağlanıyor...</p>
              <small>Deneme ${data.attempt} - ${Math.round(data.delay / 1000)} saniye bekleniyor</small>
            `;
          }

          this.updateConnectionUI();
        }
      );
    } catch (error) {
      console.error('Connect error:', error);
      this.state.isConnecting = false;
      this.updateConnectionUI();
      utils.toast(error.message, 'error');

      this.resetConnectButton();
    }
  }

  resetConnectButton() {
    const connectBtn = document.getElementById('connect-btn');
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.innerHTML = '<i class="fas fa-plug"></i> Bağlantıyı Başlat';
    }
  }

  // ─────────────── KOD İLE BAĞLANMA (pairing) ───────────────

  enterPairingMode() {
    // QR akışını durdur; pairing modu QR'dan bağımsız çalışır.
    api.stopQRStream();
    this.stopPairingStatusPoll();
    this._pairingRequested = false;

    utils.hide('qr-container');
    utils.hide('connect-btn');
    utils.hide('pairing-toggle-btn');
    utils.hide('qr-steps');
    utils.hide('pairing-code-result');
    utils.show('pairing-panel');

    document.getElementById('pairing-phone')?.focus();
  }

  exitPairingMode(cancelServer = false) {
    this.stopPairingStatusPoll();

    // QR'a geçerken: sunucudaki pairing denemesini iptal et ki QR temiz başlasın
    // (hata atmadan). Yalnız gerçekten kod istenmişse iptal et — QR sayacını
    // gereksiz yere sıfırlamamak için (Task 2).
    if (cancelServer && this._pairingRequested) {
      api.cancelConnection().catch(() => { });
    }
    this._pairingRequested = false;

    utils.hide('pairing-panel');
    utils.hide('pairing-code-result');
    utils.show('qr-container');
    utils.show('connect-btn');
    utils.show('pairing-toggle-btn');
    utils.show('qr-steps');
  }

  async requestPairingCode(isRefresh = false) {
    const input = document.getElementById('pairing-phone');
    const phone = (input?.value || '').replace(/\D/g, '');

    if (phone.length < 10) {
      utils.toast('Geçerli bir telefon numarası girin (ülke kodu ile)', 'warning');
      return;
    }

    // Sunucuya erişilebilir mi? + zaten bağlı mı?
    try {
      const pre = await api.getStatus();
      if (pre.success && pre.data?.isConnected) {
        utils.toast('WhatsApp zaten bağlı!', 'success');
        this.exitPairingMode();
        return;
      }
      this.state.apiReady = true;
      this.updateApiStatusDot('connected');
    } catch (e) {
      utils.toast('Sunucuya erişilemiyor. Bağlantı ayarlarını kontrol edin.', 'error');
      this.updateApiStatusDot('error');
      return;
    }

    const loadingBtn = isRefresh ? 'pairing-refresh-btn' : 'pairing-code-btn';
    try {
      utils.setLoading(loadingBtn, true, isRefresh ? 'Yenileniyor...' : 'Alınıyor...');

      const response = await api.requestPairingCode(phone);
      if (response.success && response.data?.pairingCode) {
        const code = response.data.pairingCode;
        const valueEl = document.getElementById('pairing-code-value');
        // 4-4 grupla (ABCD-EFGH) — okunaklı olsun.
        if (valueEl) valueEl.textContent = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
        utils.show('pairing-code-result');

        this._pairingRequested = true;
        this.state.isConnecting = true;
        this.state.isConnected = false;

        utils.toast(isRefresh ? 'Yeni kod oluşturuldu' : 'Kod oluşturuldu, WhatsApp\'a girin', 'success');
        this.startPairingStatusPoll();
      } else {
        throw new Error(response.message || 'Kod alınamadı');
      }
    } catch (error) {
      console.error('Pairing code error:', error);
      utils.toast(error.message || 'Kod alınamadı', 'error');
    } finally {
      utils.setLoading(loadingBtn, false);
    }
  }

  startPairingStatusPoll() {
    this.stopPairingStatusPoll();
    let attempts = 0;
    const maxAttempts = 60; // ~3 dk (3 sn × 60)

    this._pairingPollTimer = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        this.stopPairingStatusPoll();
        this.state.isConnecting = false;
        this.updateConnectionUI();
        utils.toast('Kod süresi doldu, tekrar deneyin', 'warning');
        return;
      }

      try {
        const response = await api.getStatus();
        if (response.success && response.data?.isConnected) {
          this.stopPairingStatusPoll();
          this.state.isConnected = true;
          this.state.isConnecting = false;
          this.state.sessionInfo = response.data.session;
          this.state.hasSession = true;
          this.exitPairingMode();
          this.resetConnectButton();
          this.updateConnectionUI();
          utils.toast('WhatsApp bağlandı!', 'success');
          this.loadDashboardData();
        }
      } catch (e) {
        // Sessiz geç; bir sonraki turda tekrar denenir.
      }
    }, 3000);
  }

  stopPairingStatusPoll() {
    if (this._pairingPollTimer) {
      clearInterval(this._pairingPollTimer);
      this._pairingPollTimer = null;
    }
  }

  async disconnect() {
    if (!await utils.showConfirm('WhatsApp oturumundan çıkmak istediğinize emin misiniz?')) return;

    try {
      utils.setLoading('disconnect-btn', true, 'Çıkış...');

      api.stopQRStream();
      this.stopPairingStatusPoll();
      this.exitPairingMode();

      await api.logout();

      this.state.isConnected = false;
      this.state.isConnecting = false;
      this.state.sessionInfo = null;
      this.state.hasSession = false;

      this.resetConnectButton();

      const qrImg = document.getElementById('qr-image');
      const qrPlaceholder = document.getElementById('qr-placeholder');
      if (qrImg) {
        qrImg.classList.add('hidden');
        qrImg.src = '';
      }
      if (qrPlaceholder) {
        utils.show(qrPlaceholder);
      }

      this.updateConnectionUI();
      utils.toast('Çıkış yapıldı', 'success');
    } catch (error) {
      console.error('Disconnect error:', error);

      if (error.status === 409) {
        utils.toast('Aktif oturum bulunamadı', 'warning');
      } else {
        utils.toast(error.message || 'Çıkış yapılamadı', 'error');
      }

      this.state.isConnected = false;
      this.state.isConnecting = false;
      this.state.hasSession = false;
      this.updateConnectionUI();

      this.resetConnectButton();

      const qrImg = document.getElementById('qr-image');
      const qrPlaceholder = document.getElementById('qr-placeholder');
      if (qrImg) {
        qrImg.classList.add('hidden');
        qrImg.src = '';
      }
      if (qrPlaceholder) {
        utils.show(qrPlaceholder);
      }
    } finally {
      utils.setLoading('disconnect-btn', false);
    }
  }

  showConnectionOverlay() {
    const overlay = document.getElementById('connection-overlay');
    if (overlay) overlay.classList.add('active');
  }

  hideConnectionOverlay() {
    const overlay = document.getElementById('connection-overlay');
    if (overlay) overlay.classList.remove('active');
  }

  openApiModal(tab = 'servers', prefillData = null) {
    const backdrop = document.getElementById('api-modal-backdrop');
    const modal = document.getElementById('api-modal');
    if (!backdrop || !modal) return;

    backdrop.classList.remove('hidden');
    modal.classList.remove('hidden');

    requestAnimationFrame(() => {
      backdrop.classList.add('visible');
      modal.classList.add('visible');
    });

    this.switchModalTab(tab);

    if (prefillData) {
      const urlInput = document.getElementById('api-url');
      const keyInput = document.getElementById('api-key');
      if (urlInput) urlInput.value = prefillData.url || '';
      if (keyInput) keyInput.value = prefillData.key || '';
    }

    this.updateApiModalStatus();

    this.renderModalServerList();
  }

  switchModalTab(tabName) {
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));

    const tab = document.querySelector(`.modal-tab[data-modal-tab="${tabName}"]`);
    const content = document.getElementById(`modal-tab-${tabName}`);
    if (tab) tab.classList.add('active');
    if (content) content.classList.add('active');

    if (tabName === 'add-server') {
      this.clearAddServerForm();
    }
  }

  clearAddServerForm() {
    const urlInput = document.getElementById('api-url');
    const keyInput = document.getElementById('api-key');
    if (urlInput) urlInput.value = '';
    if (keyInput) keyInput.value = '';
  }

  closeApiModal() {
    const backdrop = document.getElementById('api-modal-backdrop');
    const modal = document.getElementById('api-modal');
    if (!backdrop || !modal) return;

    backdrop.classList.remove('visible');
    modal.classList.remove('visible');

    setTimeout(() => {
      backdrop.classList.add('hidden');
      modal.classList.add('hidden');
    }, 300);
  }

  updateApiModalStatus() {
    const dot = document.getElementById('api-modal-status-dot');
    const text = document.getElementById('api-modal-status-text');
    const triggerDot = document.getElementById('api-trigger-dot');

    if (this.state.apiReady) {
      if (dot) { dot.classList.remove('error'); dot.classList.add('connected'); }
      if (text) text.textContent = 'API bağlantısı aktif';
      if (triggerDot) { triggerDot.classList.remove('error'); triggerDot.classList.add('connected'); }
    } else {
      if (dot) { dot.classList.remove('connected'); dot.classList.add('error'); }
      if (text) text.textContent = 'API bağlantısı yapılmadı';
      if (triggerDot) { triggerDot.classList.remove('connected'); triggerDot.classList.add('error'); }
    }
  }

  async clearApiSettings() {
    if (!await utils.showConfirm('API bağlantı bilgileri silinecek. Devam etmek istiyor musunuz?')) return;

    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.remove(['apiUrl', 'apiKey'], () => {
        utils.toast('API bilgileri temizlendi', 'success');
      });
    } else {
      localStorage.removeItem('apiUrl');
      localStorage.removeItem('apiKey');
      utils.toast('API bilgileri temizlendi', 'success');
    }

    const urlInput = document.getElementById('api-url');
    const keyInput = document.getElementById('api-key');
    if (urlInput) urlInput.value = '';
    if (keyInput) keyInput.value = '';

    this.state.apiReady = false;
    this.state.isConnected = false;
    api.baseUrl = '';
    api.apiKey = '';

    this.updateApiStatusDot('');

    this.updateConnectionUI();

    this.updateSidebarLock();

    this.showConnectionOverlay();

    this.closeApiModal();
    setTimeout(() => this.openApiModal(), 400);
  }

  updateApiStatusDot(status) {
    const triggerDot = document.getElementById('api-trigger-dot');
    if (triggerDot) {
      triggerDot.classList.remove('connected', 'error');
      if (status === 'connected') triggerDot.classList.add('connected');
      else if (status === 'error') triggerDot.classList.add('error');
    }

    const modalDot = document.getElementById('api-modal-status-dot');
    const modalText = document.getElementById('api-modal-status-text');
    if (modalDot) {
      modalDot.classList.remove('connected', 'error');
      if (status === 'connected') {
        modalDot.classList.add('connected');
        if (modalText) modalText.textContent = 'API bağlantısı aktif';
      } else if (status === 'error') {
        modalDot.classList.add('error');
        if (modalText) modalText.textContent = 'API bağlantı hatası';
      } else {
        if (modalText) modalText.textContent = 'Sunucu bilgilerinizi girin';
      }
    }
  }

  async updateApiInfoDisplay() {
    // Aktif sunucu kayıtlı listede yoksa otomatik ekle (güvenlik ağı).
    const currentUrl = api.baseUrl;
    if (currentUrl) {
      const servers = await this.getSavedServers();
      if (!servers.find(s => s.url === currentUrl)) {
        await this.addOrUpdateServer(currentUrl, api.apiKey); // bu tekrar updateApiInfoDisplay çağırır
        return;
      }
    }
    this.renderModalServerList();
  }

  async getSavedServers() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(['savedServers'], (result) => {
          resolve(result.savedServers || []);
        });
      } else {
        const saved = localStorage.getItem('savedServers');
        resolve(saved ? JSON.parse(saved) : []);
      }
    });
  }

  async saveServers(servers) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ savedServers: servers }, resolve);
      } else {
        localStorage.setItem('savedServers', JSON.stringify(servers));
        resolve();
      }
    });
  }

  async addOrUpdateServer(url, key, name = null) {
    const normalizedUrl = url.replace(/\/api\/?$/, '').replace(/\/+$/, '');
    const servers = await this.getSavedServers();
    const existing = servers.findIndex(s => s.url === normalizedUrl);
    const serverName = name || new URL(normalizedUrl).hostname || 'Sunucu';

    if (existing >= 0) {
      servers[existing] = { ...servers[existing], url: normalizedUrl, key, name: serverName, updatedAt: Date.now() };
    } else {
      servers.push({ id: Date.now().toString(), url: normalizedUrl, key, name: serverName, createdAt: Date.now(), updatedAt: Date.now() });
    }

    await this.saveServers(servers);
    this.updateApiInfoDisplay();
  }

  async removeServer(serverId) {
    if (!await utils.showConfirm('Bu sunucuyu listeden kaldırmak istiyor musunuz?')) return;
    const servers = await this.getSavedServers();
    const filtered = servers.filter(s => s.id !== serverId);
    await this.saveServers(filtered);

    const removed = servers.find(s => s.id === serverId);
    if (removed && removed.url === api.baseUrl) {
      this.clearApiSettings();
    } else {
      this.updateApiInfoDisplay();
    }
  }

  async switchServer(serverId) {
    const servers = await this.getSavedServers();
    const server = servers.find(s => s.id === serverId);
    if (!server) return;

    api.stopQRStream();

    await api.saveSettings(server.url, server.key);

    try {
      await this.checkConnection();
      this.state.apiReady = true;
      this.updateSidebarLock();

      if (this.state.isConnected) {
        this.closeApiModal();
        this.hideConnectionOverlay();
        this.switchTab('messaging');
        this.updateApiStatusDot('connected');
        utils.toast(`${server.name} sunucusuna bağlandı`, 'success');
      } else {
        this.closeApiModal();
        this.showConnectionOverlay();
        this.updateApiStatusDot('connected');
        this.resetConnectButton();
        utils.toast(`${server.name} API bağlı, WhatsApp bağlantısı bekleniyor`, 'info');
      }
    } catch (e) {
      this.state.apiReady = false;
      this.updateSidebarLock();
      this.updateApiStatusDot('error');
      utils.toast(`${server.name} sunucusuna bağlanılamadı`, 'error');
    }

    this.renderModalServerList();
    this.updateApiInfoDisplay();
  }

  async renderModalServerList() {
    const container = document.getElementById('modal-server-list');
    if (!container) return;

    const servers = await this.getSavedServers();
    const currentUrl = api.baseUrl;

    if (servers.length === 0) {
      container.innerHTML = `
        <div class="modal-servers-empty">
          <i class="fas fa-server"></i>
          <p>Henüz kayıtlı sunucu yok</p>
          <button class="btn btn-primary btn-sm" id="modal-go-add"><i class="fas fa-plus"></i> Sunucu Ekle</button>
        </div>`;
      document.getElementById('modal-go-add')?.addEventListener('click', () => this.switchModalTab('add-server'));
      return;
    }

    container.innerHTML = `<div class="modal-servers-label">Kayıtlı Sunucular</div>` + servers.map((server, index) => {
      const isActive = server.url === currentUrl;
      const displayUrl = (() => { try { return new URL(server.url).host; } catch { return server.url; } })();
      return `
        <div class="modal-server-item ${isActive ? 'active' : ''}" data-id="${server.id}" data-index="${index}">
          <div class="modal-server-drag-handle" title="Sürükleyerek sıralayın"><i class="fas fa-grip-vertical"></i></div>
          <div class="modal-server-dot ${isActive ? 'connected' : ''}"></div>
          <div class="modal-server-info">
            <span class="modal-server-name">${utils.escapeHtml(server.name)}</span>
            <span class="modal-server-url">${utils.escapeHtml(displayUrl)}</span>
          </div>
          ${isActive ? '<span class="modal-server-active-tag"><i class="fas fa-check"></i> Aktif</span>' : '<span class="modal-server-connect-tag"><i class="fas fa-plug"></i> Bağlan</span>'}
          <button class="modal-server-delete" data-id="${server.id}" title="Sil"><i class="fas fa-times"></i></button>
        </div>`;
    }).join('');

    container.querySelectorAll('.modal-server-item:not(.active)').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.modal-server-delete') || e.target.closest('.modal-server-drag-handle')) return;
        this.switchServer(item.dataset.id);
      });
    });

    container.querySelectorAll('.modal-server-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeServer(btn.dataset.id);
      });
    });

    this._setupServerDragDrop(container);
  }

  _setupServerDragDrop(container) {
    if (this._dragCleanup) {
      this._dragCleanup();
    }

    let draggedItem = null;
    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    let itemHeight = 0;

    const getServerItems = () => [...container.querySelectorAll('.modal-server-item')];

    const onMouseDown = (e) => {
      const handle = e.target.closest('.modal-server-drag-handle');
      if (!handle) return;

      const item = handle.closest('.modal-server-item');
      if (!item) return;

      e.preventDefault();
      draggedItem = item;
      startY = e.clientY;
      itemHeight = item.getBoundingClientRect().height + 3;

      item.classList.add('modal-server-dragging');
      container.classList.add('modal-servers-reordering');
      isDragging = true;
    };

    const onMouseMove = (e) => {
      if (!isDragging || !draggedItem) return;

      currentY = e.clientY;
      const deltaY = currentY - startY;
      const moveCount = Math.round(deltaY / itemHeight);

      if (moveCount === 0) return;

      const currentItems = getServerItems();
      const currentIndex = currentItems.indexOf(draggedItem);
      const newIndex = Math.max(0, Math.min(currentItems.length - 1, currentIndex + (moveCount > 0 ? 1 : -1)));

      if (newIndex !== currentIndex) {
        const referenceItem = currentItems[newIndex];
        if (referenceItem) {
          if (newIndex > currentIndex) {
            referenceItem.after(draggedItem);
          } else {
            container.insertBefore(draggedItem, referenceItem);
          }
          startY = currentY;
        }
      }
    };

    const onMouseUp = async () => {
      if (!isDragging || !draggedItem) return;

      draggedItem.classList.remove('modal-server-dragging');
      container.classList.remove('modal-servers-reordering');

      const finalItems = getServerItems();
      const newOrder = finalItems.map(el => el.dataset.id);
      await this._reorderServers(newOrder);

      isDragging = false;
      draggedItem = null;
    };

    container.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    this._dragCleanup = () => {
      container.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }

  async _reorderServers(orderedIds) {
    const servers = await this.getSavedServers();
    const reordered = [];

    for (const id of orderedIds) {
      const server = servers.find(s => s.id === id);
      if (server) reordered.push(server);
    }

    for (const server of servers) {
      if (!reordered.find(s => s.id === server.id)) {
        reordered.push(server);
      }
    }

    await this.saveServers(reordered);
    this.renderModalServerList();
  }

  updateSidebarLock() {
    const canNavigate = this.state.apiReady && this.state.isConnected;
    const tabTitles = { 'messaging': 'Mesaj Gönderimi', 'dashboard': 'Kontrol Paneli' };
    document.querySelectorAll('.sidebar-nav-item[data-tab]').forEach(item => {
      const tab = item.dataset.tab;
      if (!canNavigate) {
        item.classList.add('locked');
        if (!this.state.apiReady) {
          item.setAttribute('title', 'Önce API bağlantısını yapılandırın');
        } else {
          item.setAttribute('title', 'WhatsApp bağlı değil');
        }
      } else {
        item.classList.remove('locked');
        item.setAttribute('title', tabTitles[tab] || tab);
      }
    });
  }

  toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);

    const icon = document.querySelector('#theme-toggle i');
    if (icon) {
      icon.className = next === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }

    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ theme: next });
    } else {
      localStorage.setItem('theme', next);
    }
  }

  async loadTheme() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(['theme'], (result) => {
          if (result.theme) {
            document.documentElement.setAttribute('data-theme', result.theme);
            const icon = document.querySelector('#theme-toggle i');
            if (icon) icon.className = result.theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
          }
          resolve();
        });
      } else {
        const theme = localStorage.getItem('theme');
        if (theme) {
          document.documentElement.setAttribute('data-theme', theme);
          const icon = document.querySelector('#theme-toggle i');
          if (icon) icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        }
        resolve();
      }
    });
  }

  async loadServerSettings() {
    const loadingEl = document.getElementById('dashboard-server-loading');
    const contentEl = document.getElementById('dashboard-server-content');
    const errorEl = document.getElementById('dashboard-server-error');

    if (loadingEl) utils.show(loadingEl);
    if (contentEl) utils.hide(contentEl);
    if (errorEl) utils.hide(errorEl);

    try {
      const response = await api.getAppSettings();

      if (response.success && response.data) {
        const data = response.data;

        document.getElementById('server-auto-read').checked = data.autoRead || false;
        document.getElementById('server-notify').checked = data.notify || false;
        document.getElementById('server-call-reject').checked = data.callReject?.enabled || false;

        // Yazıyor süresi (ENV: TYPING_DURATION) — ms → sn
        const typingSlider = document.getElementById('typing-duration');
        const typingLabel = document.getElementById('typing-duration-value');
        const typingSec = Math.round((data.typingDuration ?? 4000) / 1000);
        if (typingSlider) typingSlider.value = typingSec;
        if (typingLabel) typingLabel.textContent = typingSec === 0 ? 'Kapalı' : `${typingSec} sn`;

        utils.hide(loadingEl);
        utils.show(contentEl);
      } else {
        throw new Error('Invalid response');
      }
    } catch (error) {
      console.error('Load server settings error:', error);
      utils.hide(loadingEl);
      utils.show(errorEl);
    }
  }

  async saveServerSettings() {
    try {
      utils.setLoading('save-server-settings', true);

      const settings = {
        autoRead: document.getElementById('server-auto-read').checked,
        notify: document.getElementById('server-notify').checked,
        callReject: {
          enabled: document.getElementById('server-call-reject').checked
        },
        typingDuration: parseInt(document.getElementById('typing-duration')?.value || '4', 10) * 1000
      };

      const response = await api.updateAppSettings(settings);

      if (response.success) {
        utils.toast('Sunucu ayarları kaydedildi', 'success');
        await this.loadServerSettings();
      } else {
        throw new Error(response.message || 'Ayarlar kaydedilemedi');
      }
    } catch (error) {
      console.error('Save server settings error:', error);
      utils.toast('Ayarlar kaydedilemedi: ' + error.message, 'error');
    } finally {
      utils.setLoading('save-server-settings', false);
    }
  }

  openTerminalPopup() {
    const popup = document.getElementById('terminal-popup');
    const status = document.getElementById('terminal-status');
    const output = document.getElementById('terminal-output');

    if (!popup) return;

    popup.classList.remove('hidden');

    status.className = 'terminal-popup-status';
    status.innerHTML = '<span class="terminal-status-dot"></span><span>Bağlanıyor...</span>';
    output.innerHTML = '<div class="terminal-empty"><i class="fas fa-terminal"></i><span>Log akışı başlatılıyor...</span></div>';

    this._terminalAutoScroll = true;

    output.addEventListener('scroll', () => {
      this._terminalAutoScroll = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
    });

    api.startTerminalStream(
      (logEntry) => {
        this.appendTerminalLog(logEntry);
      },
      () => {
        status.className = 'terminal-popup-status connected';
        status.innerHTML = '<span class="terminal-status-dot"></span><span>Bağlı — Canlı log akışı</span>';
        const empty = output.querySelector('.terminal-empty');
        if (empty) empty.remove();
      },
      (error) => {
        console.error('Terminal stream error:', error);
        status.className = 'terminal-popup-status error';
        status.innerHTML = '<span class="terminal-status-dot"></span><span>Bağlantı kesildi</span>';
      }
    );
  }

  closeTerminalPopup() {
    const popup = document.getElementById('terminal-popup');
    if (popup) popup.classList.add('hidden');
    api.stopTerminalStream();
  }

  async clearTerminalOutput() {
    const output = document.getElementById('terminal-output');
    if (output) {
      output.innerHTML = '<div class="terminal-empty"><i class="fas fa-terminal"></i><span>Log temizlendi</span></div>';
    }

    try {
      await api.clearTerminalLogs();
    } catch (error) {
      console.error('Failed to clear server logs:', error);
    }
  }

  appendTerminalLog(entry) {
    const output = document.getElementById('terminal-output');
    if (!output) return;

    const empty = output.querySelector('.terminal-empty');
    if (empty) empty.remove();

    const line = document.createElement('div');
    line.className = 'terminal-line';

    const time = entry.timestamp
      ? new Date(entry.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '';

    const level = entry.level || 'info';
    const category = entry.category || 'system';
    const message = entry.message || '';
    const hasData = entry.data && Object.keys(entry.data).length > 0;

    line.innerHTML = `
      <span class="terminal-time">${utils.escapeHtml(time)}</span>
      <span class="terminal-level ${level}">${level}</span>
      <span class="terminal-category">${utils.escapeHtml(category)}</span>
      <span class="terminal-msg">${utils.escapeHtml(message)}</span>
      ${hasData ? `<span class="terminal-data" title="${utils.escapeHtml(JSON.stringify(entry.data))}"><i class="fas fa-ellipsis-h"></i></span>` : ''}
    `;

    if (hasData) {
      const dataBtn = line.querySelector('.terminal-data');
      dataBtn?.addEventListener('click', () => {
        const formatted = JSON.stringify(entry.data, null, 2);
        const pre = document.createElement('div');
        pre.style.cssText = 'padding:4px 8px;margin:2px 0 4px 100px;background:var(--bg-input);border-radius:4px;font-size:10px;color:var(--text-secondary);white-space:pre-wrap;word-break:break-all;border:1px solid var(--border)';
        pre.textContent = formatted;
        if (line.nextElementSibling?.dataset?.dataExpanded) {
          line.nextElementSibling.remove();
        } else {
          pre.dataset.dataExpanded = 'true';
          line.after(pre);
        }
      });
    }

    output.appendChild(line);

    while (output.children.length > 500) {
      output.removeChild(output.firstChild);
    }

    if (this._terminalAutoScroll) {
      output.scrollTop = output.scrollHeight;
    }
  }

  toggleApiKeyVisibility() {
    const input = document.getElementById('api-key');
    const icon = document.querySelector('#toggle-api-key i');

    if (input.type === 'password') {
      input.type = 'text';
      icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
      input.type = 'password';
      icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
  }

  async saveSettings() {
    const url = document.getElementById('api-url').value.trim();
    const key = document.getElementById('api-key').value.trim();

    if (!url) {
      utils.toast('API URL gerekli', 'warning');
      return;
    }

    try {
      utils.setLoading('save-settings', true);

      api.stopQRStream();

      await api.saveSettings(url, key);

      await this.addOrUpdateServer(url, key);

      utils.toast('API ayarları kaydedildi', 'success');

      this.clearAddServerForm();

      try {
        await this.checkConnection();
        this.state.apiReady = true;
        this.updateSidebarLock();

        if (this.state.isConnected) {
          this.closeApiModal();
          this.hideConnectionOverlay();
          this.switchTab('messaging');
          this.updateApiStatusDot('connected');
        } else {
          this.closeApiModal();
          this.showConnectionOverlay();
          this.updateApiStatusDot('connected');
          this.resetConnectButton();
        }
      } catch (e) {
        this.state.apiReady = false;
        this.updateSidebarLock();
        this.updateApiStatusDot('error');
        this.switchModalTab('servers');
        utils.toast('Sunucu kaydedildi ama bağlantı kurulamadı', 'warning');
      }

      this.renderModalServerList();
    } catch (error) {
      utils.toast(error.message, 'error');
    } finally {
      utils.setLoading('save-settings', false);
    }
  }

  async testConnection() {
    try {
      utils.setLoading('test-connection', true);
      const response = await api.getStatus();

      if (response.success) {
        this.state.apiReady = true;
        this.updateSidebarLock();
        this.updateApiStatusDot('connected');
        utils.toast('Bağlantı başarılı!', 'success');
      } else {
        this.updateApiStatusDot('error');
        utils.toast('Bağlantı başarısız', 'error');
      }
    } catch (error) {
      this.updateApiStatusDot('error');
      utils.toast('Bağlantı hatası: ' + error.message, 'error');
    } finally {
      utils.setLoading('test-connection', false);
    }
  }

  async loadDashboardData() {
    await Promise.all([
      this.loadStats(),
      this.loadQuickStats(),
      this.loadServerSettings()
    ]);
  }

  async loadStats() {
    try {
      const response = await api.getStats();

      if (response.success && response.data) {
        const data = response.data;

        const sysUptime = document.getElementById('sys-uptime');
        if (sysUptime) sysUptime.textContent = utils.formatUptime(data.server?.uptime);

        const memUsage = data.system?.memory?.usagePercent || 0;
        const sysMem = document.getElementById('sys-memory');
        const memRing = document.getElementById('mem-ring');
        if (sysMem) sysMem.textContent = `${memUsage.toFixed(1)}%`;
        if (memRing) memRing.setAttribute('stroke-dasharray', `${memUsage}, 100`);

        const healthEl = document.getElementById('sys-health');
        if (healthEl) {
          const healthStatus = data.health?.status || 'unknown';
          const healthLabels = { healthy: 'Sağlıklı', degraded: 'Düşük', unhealthy: 'Sorunlu', unknown: 'Bilinmiyor' };
          healthEl.textContent = healthLabels[healthStatus] || healthStatus;
          healthEl.className = `system-health-badge ${healthStatus}`;
        }

        const statJobs = document.getElementById('stat-jobs');
        if (statJobs) statJobs.textContent = data.queue?.activeJobs || 0;

        const waConnectionTime = document.getElementById('wa-connection-time');
        const waQueuePending = document.getElementById('wa-queue-pending');

        if (waConnectionTime) {
          if (data.whatsapp?.lastConnected) {
            const lastConnected = new Date(data.whatsapp.lastConnected);
            const now = new Date();
            const diffMs = now - lastConnected;
            waConnectionTime.textContent = utils.formatUptime(Math.floor(diffMs / 1000));
          } else if (data.whatsapp?.isConnected) {
            waConnectionTime.textContent = 'Aktif';
          } else {
            waConnectionTime.textContent = 'Bağlı değil';
          }
        }

        if (waQueuePending) {
          const pending = data.queue?.totalPendingMessages || 0;
          waQueuePending.textContent = `${pending} mesaj`;
        }
      }
    } catch (error) {
      console.error('Load stats error:', error);
    }
  }

  async loadQuickStats() {
    try {
      const response = await api.getScheduledMessages();
      if (response.success && response.data) {
        const pending = response.data.messages?.filter(m => m.status === 'pending').length || 0;
        const statScheduled = document.getElementById('stat-scheduled');
        if (statScheduled) statScheduled.textContent = pending;
      }
    } catch (error) {
      console.error('Quick stats error:', error);
    }
  }

  switchMessageType(type) {
    this.state.messageType = type;

    document.querySelectorAll('.messaging-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.type === type);
    });

    utils.toggle('single-message-form', type === 'single');
    utils.toggle('bulk-message-form', type === 'bulk');
  }

  setScheduleMode(mode) {
    this.state.singleScheduleMode = mode;

    document.querySelectorAll('.schedule-option[data-schedule]').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.schedule === mode);
    });

    utils.toggle('single-schedule-datetime', mode === 'later');

    if (mode === 'later') {
      const datetimeInput = document.getElementById('single-datetime');
      if (datetimeInput) {
        datetimeInput.min = utils.getMinScheduleDate();
        if (!datetimeInput.value) {
          const defaultDate = new Date();
          defaultDate.setHours(defaultDate.getHours() + 1);
          defaultDate.setMinutes(0);
          datetimeInput.value = utils.toLocalISOString(defaultDate);
        }
      }
    }
  }

  setSingleMessageType(type) {
    this.state.singleMessageType = type;

    document.querySelectorAll('.type-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.type === type);
    });

    utils.toggle('single-text-section', type === 'text');
    utils.toggle('single-media-section', type !== 'text');
  }

  async handleSingleSend() {
    const recipient = document.getElementById('single-recipient').value.trim();
    const message = document.getElementById('single-message').value.trim();
    const mediaUrl = document.getElementById('single-media-url').value.trim();
    const caption = document.getElementById('single-caption').value.trim();
    const isScheduled = this.state.singleScheduleMode === 'later';
    const datetime = document.getElementById('single-datetime').value;
    const type = this.state.singleMessageType;

    if (!recipient) {
      utils.toast('Alıcı numarası girin', 'warning');
      return;
    }

    if (type === 'text' && !message) {
      utils.toast('Mesaj girin', 'warning');
      return;
    }

    const mediaList = this.state.singleMediaList || [];
    if (type !== 'text' && mediaList.length === 0 && !mediaUrl) {
      utils.toast('Medya dosyası ekleyin veya URL girin', 'warning');
      return;
    }

    if (isScheduled && !datetime) {
      utils.toast('Gönderim zamanı seçin', 'warning');
      return;
    }

    if (isScheduled && datetime) {
      const scheduledTime = new Date(datetime);
      const minTime = new Date(Date.now() + 10 * 60000);
      if (scheduledTime < minTime) {
        utils.toast('Gönderim zamanı en az 10 dakika sonrası olmalıdır', 'warning');
        document.getElementById('single-datetime').min = utils.getMinScheduleDate();
        return;
      }
    }

    const btn = document.getElementById('single-send-btn');

    if (!this.state.isConnected) {
      try {
        const statusResponse = await api.getStatus();
        if (!statusResponse.success || !statusResponse.data?.isConnected) {
          utils.toast('WhatsApp bağlı değil. Lütfen önce bağlanın.', 'warning');
          return;
        }
        this.state.isConnected = true;
        this.updateConnectionUI();
      } catch (error) {
        utils.toast('Bağlantı kontrol edilemedi', 'error');
        return;
      }
    }

    try {
      utils.setLoading(btn, true, 'Gönderiliyor...');

      const normalizedPhone = utils.normalizePhone(recipient);
      if (!normalizedPhone || normalizedPhone.length < 10) {
        utils.toast('Geçersiz telefon numarası', 'warning');
        utils.setLoading(btn, false);
        return;
      }

      const jid = `${normalizedPhone}@s.whatsapp.net`;

      // Gönderilecek birimler: çoklu dosyada her dosya ayrı mesaj olur
      // (WhatsApp'ın kendisi de böyle yapar); açıklama yalnız ilk dosyaya eklenir.
      let tasks;
      if (mediaList.length > 0) {
        tasks = mediaList.map((m, i) => ({
          type: m.mediaType,
          message: '',
          options: { mediaBase64: m.base64, fileName: m.fileName, mimetype: m.mimetype, caption: i === 0 ? caption : '' }
        }));
      } else if (type !== 'text') {
        tasks = [{ type, message: '', options: { mediaUrl, caption } }];
      } else {
        tasks = [{ type: 'text', message, options: {} }];
      }

      const scheduledAt = isScheduled ? new Date(datetime).toISOString() : null;
      let ok = 0;
      for (const t of tasks) {
        const res = scheduledAt
          ? await api.scheduleMessage(jid, t.message, scheduledAt, t.type, t.options)
          : await api.sendMessage(jid, t.message, t.type, t.options);
        if (res.success) ok++;
      }

      if (ok === 0) throw new Error(isScheduled ? 'Mesaj zamanlanamadı' : 'Mesaj gönderilemedi');

      const verb = isScheduled ? 'zamanlandı' : 'gönderildi';
      utils.toast(
        ok === tasks.length ? `Mesaj ${verb}! (${ok} öğe)` : `${ok}/${tasks.length} öğe ${verb}`,
        ok === tasks.length ? 'success' : 'warning'
      );

      this.saveLastUsed('single', { type, message, caption, mediaUrl: mediaList.length ? '' : mediaUrl });
      document.getElementById('single-recipient').value = '';
      document.getElementById('single-message').value = '';
      const captionEl = document.getElementById('single-caption'); if (captionEl) captionEl.value = '';
      const sc1 = document.getElementById('single-char-count'); if (sc1) sc1.textContent = '0';
      this.clearMedia('single');
      if (isScheduled) {
        document.getElementById('single-datetime').value = '';
        this.setScheduleMode('now');
        this.loadScheduledMessages();
      }
    } catch (error) {
      const errorMsg = error.data?.error || error.data?.message || error.message || 'İşlem başarısız';
      utils.toast(errorMsg, 'error');
    } finally {
      utils.setLoading(btn, false);
    }
  }

  setBulkMessageType(type) {
    document.getElementById('bulk-type').value = type;

    document.querySelectorAll('.type-option[data-bulk-type]').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.bulkType === type);
    });

    utils.toggle('bulk-text-group', type === 'text');
    utils.toggle('bulk-media-group', type !== 'text');
  }

  // ─────────────── MEDYA SÜRÜKLE-BIRAK (Task 2) ───────────────

  static MAX_FILES = 5;
  static MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

  setupDropzone(prefix) {
    const zone = document.getElementById(`${prefix}-dropzone`);
    const input = document.getElementById(`${prefix}-file-input`);
    if (!zone || !input) return;

    if (!this.state[`${prefix}MediaList`]) this.state[`${prefix}MediaList`] = [];

    zone.addEventListener('click', (e) => {
      if (e.target.closest('.media-file-remove')) return;
      input.click();
    });

    input.addEventListener('change', () => {
      if (input.files?.length) this.handleMediaFiles(prefix, input.files);
      input.value = ''; // aynı dosya tekrar seçilebilsin
    });

    ['dragenter', 'dragover'].forEach(evt => {
      zone.addEventListener(evt, (e) => {
        e.preventDefault(); e.stopPropagation();
        zone.classList.add('dragover');
      });
    });
    ['dragleave', 'dragend', 'drop'].forEach(evt => {
      zone.addEventListener(evt, (e) => {
        e.preventDefault(); e.stopPropagation();
        zone.classList.remove('dragover');
      });
    });
    zone.addEventListener('drop', (e) => {
      if (e.dataTransfer?.files?.length) this.handleMediaFiles(prefix, e.dataTransfer.files);
    });
  }

  handleMediaFiles(prefix, fileList) {
    const list = this.state[`${prefix}MediaList`] || (this.state[`${prefix}MediaList`] = []);

    for (const file of Array.from(fileList)) {
      if (list.length >= WhatsAppBOTApp.MAX_FILES) {
        utils.toast(`En fazla ${WhatsAppBOTApp.MAX_FILES} dosya eklenebilir`, 'warning');
        break;
      }
      if (file.size > WhatsAppBOTApp.MAX_FILE_SIZE) {
        utils.toast(`"${file.name}" çok büyük (en fazla 2 MB)`, 'warning');
        continue;
      }

      const reader = new FileReader();
      reader.onload = () => {
        if (list.length >= WhatsAppBOTApp.MAX_FILES) return;
        // base64 yalnız bellekte tutulur; gönderim sonrası temizlenir.
        list.push({
          base64: String(reader.result || '').split(',')[1] || '',
          fileName: file.name,
          mimetype: file.type || 'application/octet-stream',
          size: file.size,
          mediaType: this.detectMediaType(file.type)
        });
        this.renderMediaList(prefix);
      };
      reader.onerror = () => utils.toast(`"${file.name}" okunamadı`, 'error');
      reader.readAsDataURL(file);
    }

    // Dosya eklenince URL alanını temizle (dosya öncelikli).
    const urlInput = document.getElementById(`${prefix}-media-url`);
    if (urlInput) urlInput.value = '';
  }

  detectMediaType(mime) {
    const m = (mime || '').toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    return 'document';
  }

  renderMediaList(prefix) {
    const list = this.state[`${prefix}MediaList`] || [];
    const empty = document.getElementById(`${prefix}-dropzone-empty`);
    const listEl = document.getElementById(`${prefix}-file-list`);
    if (!listEl) return;

    // İlk dosyaya göre form tipini ayarla (medya bölümü görünür kalsın).
    if (list.length > 0) {
      if (prefix === 'single') this.setSingleMessageType(list[0].mediaType);
      else this.setBulkMessageType(list[0].mediaType);
    }

    if (list.length === 0) {
      if (empty) utils.show(empty);
      utils.hide(listEl);
      listEl.innerHTML = '';
      return;
    }

    if (empty) utils.hide(empty);
    utils.show(listEl);

    const iconMap = { image: 'fa-image', video: 'fa-video', document: 'fa-file-lines' };
    listEl.innerHTML = list.map((m, i) => {
      const kb = m.size / 1024;
      const sizeStr = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
      return `
        <div class="media-file">
          <i class="fas ${iconMap[m.mediaType] || 'fa-file'} media-file-icon"></i>
          <div class="media-file-meta"><span class="media-file-name">${utils.escapeHtml(m.fileName)}</span><span class="media-file-size">${sizeStr}</span></div>
          <button type="button" class="media-file-remove" data-index="${i}" title="Kaldır"><i class="fas fa-times"></i></button>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.media-file-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        list.splice(idx, 1);
        this.renderMediaList(prefix);
      });
    });
  }

  clearMedia(prefix) {
    this.state[`${prefix}MediaList`] = [];
    const input = document.getElementById(`${prefix}-file-input`);
    if (input) input.value = '';
    this.renderMediaList(prefix);
  }

  // ─────────────── GEÇERSİZ NUMARA POPUP (Task 1) ───────────────

  showInvalidNumbersPopup(numbers, allInvalid = false) {
    const backdrop = document.getElementById('invalid-backdrop');
    const dialog = document.getElementById('invalid-dialog');
    const msg = document.getElementById('invalid-message');
    const list = document.getElementById('invalid-list');
    if (!backdrop || !dialog || !list) return;

    if (msg) {
      msg.textContent = allInvalid
        ? 'Hiçbir numaranın WhatsApp profili yok'
        : `${numbers.length} numaranın WhatsApp profili yok (gönderilmedi)`;
    }

    list.innerHTML = numbers
      .map(n => `<div class="invalid-list-item"><i class="fas fa-xmark"></i> +${utils.escapeHtml(String(n))}</div>`)
      .join('');

    backdrop.classList.remove('hidden');
    dialog.classList.remove('hidden');
  }

  closeInvalidPopup() {
    document.getElementById('invalid-backdrop')?.classList.add('hidden');
    document.getElementById('invalid-dialog')?.classList.add('hidden');
  }

  // ─────────────── SON KULLANILAN AYARLAR (Task 3) ───────────────

  saveLastUsed(kind, data) {
    const key = `lastUsed_${kind}`;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ [key]: data });
    } else {
      localStorage.setItem(key, JSON.stringify(data));
    }
  }

  getLastUsed(kind) {
    return new Promise((resolve) => {
      const key = `lastUsed_${kind}`;
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get([key], (r) => resolve(r[key] || null));
      } else {
        const v = localStorage.getItem(key);
        resolve(v ? JSON.parse(v) : null);
      }
    });
  }

  async restoreLastUsed() {
    const single = await this.getLastUsed('single');
    if (single) {
      if (single.type) this.setSingleMessageType(single.type);
      if (single.message) {
        const el = document.getElementById('single-message');
        if (el) {
          el.value = single.message;
          const c = document.getElementById('single-char-count');
          if (c) c.textContent = single.message.length;
        }
      }
      if (single.caption) { const el = document.getElementById('single-caption'); if (el) el.value = single.caption; }
      if (single.mediaUrl) { const el = document.getElementById('single-media-url'); if (el) el.value = single.mediaUrl; }
    }

    const bulk = await this.getLastUsed('bulk');
    if (bulk) {
      if (bulk.type) this.setBulkMessageType(bulk.type);
      if (bulk.message) {
        const el = document.getElementById('bulk-message');
        if (el) { el.value = bulk.message; this.updateBulkCharCount(bulk.message); }
      }
      if (bulk.caption) { const el = document.getElementById('bulk-caption'); if (el) el.value = bulk.caption; }
      if (bulk.mediaUrl) { const el = document.getElementById('bulk-media-url'); if (el) el.value = bulk.mediaUrl; }
      if (typeof bulk.minDelay === 'number') { const el = document.getElementById('bulk-min-delay'); if (el) el.value = bulk.minDelay; }
      if (typeof bulk.maxDelay === 'number') { const el = document.getElementById('bulk-max-delay'); if (el) el.value = bulk.maxDelay; }
    }
  }

  updateRecipientCount(text) {
    const lines = text.split(/\n/).filter(line => line.trim().length > 0);
    document.getElementById('recipient-count').textContent = lines.length;
  }

  updateBulkCharCount(text) {
    document.getElementById('bulk-char-count').textContent = text.length;
  }

  async handleBulkSend() {
    const recipientsText = document.getElementById('bulk-recipients').value;
    const type = document.getElementById('bulk-type').value;
    const message = document.getElementById('bulk-message').value.trim();
    const mediaUrl = document.getElementById('bulk-media-url').value.trim();
    const caption = document.getElementById('bulk-caption').value.trim();
    const minDelay = parseInt(document.getElementById('bulk-min-delay').value) * 1000;
    const maxDelay = parseInt(document.getElementById('bulk-max-delay').value) * 1000;
    const useSchedule = document.getElementById('bulk-schedule-enabled')?.checked;
    const scheduleDateTime = document.getElementById('bulk-start-datetime')?.value;
    const mediaList = this.state.bulkMediaList || [];

    const recipients = utils.parseRecipients(recipientsText);

    if (recipients.length === 0) {
      utils.toast('Geçerli alıcı numarası girin', 'warning');
      return;
    }

    if (type === 'text' && !message) {
      utils.toast('Mesaj girin', 'warning');
      return;
    }

    if (type !== 'text' && mediaList.length === 0 && !mediaUrl) {
      utils.toast('Medya dosyası ekleyin veya URL girin', 'warning');
      return;
    }

    if (useSchedule && scheduleDateTime) {
      const scheduledTime = new Date(scheduleDateTime);
      const minTime = new Date(Date.now() + 10 * 60000);
      if (scheduledTime < minTime) {
        utils.toast('Başlangıç zamanı en az 10 dakika sonrası olmalıdır', 'warning');
        const dtInput = document.getElementById('bulk-start-datetime');
        if (dtInput) dtInput.min = utils.getMinScheduleDate();
        return;
      }
    }

    if (useSchedule && !scheduleDateTime) {
      utils.toast('Başlangıç zamanı seçin', 'warning');
      return;
    }

    const btn = document.getElementById('bulk-send-btn');

    if (!this.state.isConnected) {
      try {
        const statusResponse = await api.getStatus();
        if (!statusResponse.success || !statusResponse.data?.isConnected) {
          utils.toast('WhatsApp bağlı değil. Lütfen önce bağlanın.', 'warning');
          return;
        }
        this.state.isConnected = true;
        this.updateConnectionUI();
      } catch (error) {
        utils.toast('Bağlantı kontrol edilemedi', 'error');
        return;
      }
    }

    try {
      utils.setLoading(btn, true, 'Numaralar kontrol ediliyor...');

      // Numara/profil kontrolü: geçersizleri ayıkla, kullanıcıya popup ile bildir.
      let validRecipients = recipients;
      try {
        const valRes = await api.validateNumbers(recipients);
        if (valRes.success && valRes.data) {
          validRecipients = valRes.data.valid || [];
          const invalid = valRes.data.invalid || [];

          if (validRecipients.length === 0) {
            this.showInvalidNumbersPopup(invalid, true);
            return;
          }
          if (invalid.length > 0) {
            this.showInvalidNumbersPopup(invalid, false);
          }
        }
      } catch (valErr) {
        console.error('Number validation failed:', valErr);
        // Doğrulama yapılamazsa girilen numaralarla devam et (engelleyici olma).
      }

      utils.setLoading(btn, true, 'Başlatılıyor...');

      // Çoklu dosya: her alıcıya tüm dosyalar sırayla gider (açıklama ilk dosyada).
      const bulkType = mediaList.length ? mediaList[0].mediaType : type;
      const options = mediaList.length
        ? { minDelay, maxDelay, caption, mediaItems: mediaList.map(m => ({ type: m.mediaType, mediaBase64: m.base64, fileName: m.fileName, mimetype: m.mimetype })) }
        : { minDelay, maxDelay, mediaUrl, caption };

      if (useSchedule && scheduleDateTime) {
        options.scheduledAt = new Date(scheduleDateTime).toISOString();
      }

      const response = await api.createBulkJob(validRecipients, message, bulkType, options);

      if (response.success) {
        const successMsg = useSchedule ?
          `Toplu gönderim zamanlandı (${validRecipients.length} alıcı)` :
          `Toplu gönderim başlatıldı (${validRecipients.length} alıcı)`;
        utils.toast(successMsg, 'success');
        this.saveLastUsed('bulk', {
          type, message, caption,
          mediaUrl: mediaList.length ? '' : mediaUrl,
          minDelay: parseInt(document.getElementById('bulk-min-delay').value),
          maxDelay: parseInt(document.getElementById('bulk-max-delay').value)
        });
        document.getElementById('bulk-recipients').value = '';
        document.getElementById('bulk-message').value = '';
        document.getElementById('recipient-count').textContent = '0';
        document.getElementById('bulk-char-count').textContent = '0';
        this.clearMedia('bulk');
        const scheduleCheckbox = document.getElementById('bulk-schedule-enabled');
        if (scheduleCheckbox) {
          scheduleCheckbox.checked = false;
          utils.hide('bulk-schedule-datetime');
        }
        document.querySelectorAll('.schedule-option[data-bulk-schedule]').forEach(o => o.classList.remove('active'));
        document.querySelector('.schedule-option[data-bulk-schedule="now"]')?.classList.add('active');
        await this.loadBulkJobs();
      }
    } catch (error) {
      const errorMsg = error.data?.error || error.data?.message || error.message || 'İşlem başarısız';
      utils.toast(errorMsg, 'error');
    } finally {
      utils.setLoading(btn, false);
    }
  }

  async loadBulkJobs() {
    try {
      const response = await api.getBulkJobs();
      const container = document.getElementById('jobs-list');

      if (response.success && response.data?.jobs?.length > 0) {
        container.innerHTML = response.data.jobs.map(job => this.renderJobItem(job)).join('');

        container.querySelectorAll('[data-action]').forEach(btn => {
          btn.addEventListener('click', () => this.handleJobAction(btn.dataset.action, btn.dataset.jobId));
        });
      } else {
        container.innerHTML = `
          <div class="status-empty">
            <i class="fas fa-tasks"></i>
            <span>Aktif iş yok</span>
          </div>
        `;
      }
    } catch (error) {
      console.error('Load jobs error:', error);
    }
  }

  renderJobItem(job) {
    const progress = job.total > 0 ? ((job.success + job.failed) / job.total * 100) : 0;
    const statusClass = utils.getStatusClass(job.status);
    const isActive = job.status === 'active' || job.status === 'processing';
    const isPaused = job.status === 'paused';
    const isCompleted = ['completed', 'failed', 'cancelled'].includes(job.status);

    const statusLabels = {
      'active': 'Aktif',
      'processing': 'İşleniyor',
      'paused': 'Duraklatıldı',
      'completed': 'Tamamlandı',
      'failed': 'Başarısız',
      'cancelled': 'İptal Edildi',
      'scheduled': 'Zamanlandı'
    };
    const statusLabel = statusLabels[job.status] || job.status;

    const createdAt = utils.formatDate(job.createdAt, 'short');
    const messagePreview = utils.truncate(job.message || job.caption || '[Medya]', 30);

    return `
      <div class="job-item" data-job-id="${job.jobId}">
        <div class="job-item-header">
          <span class="job-id" title="${job.jobId}">#${utils.truncate(job.jobId, 8)}</span>
          <span class="job-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="job-message-preview" title="${utils.escapeHtml(job.message || job.caption || '')}">${utils.escapeHtml(messagePreview)}</div>
        <div class="job-progress">
          <div class="job-progress-bar">
            <div class="job-progress-fill" style="width: ${progress}%"></div>
          </div>
        </div>
        <div class="job-stats">
          <span title="Başarılı"><i class="fas fa-check" style="color: var(--success);"></i> ${job.success}</span>
          <span title="Başarısız"><i class="fas fa-times" style="color: var(--danger);"></i> ${job.failed}</span>
          <span title="Bekleyen"><i class="fas fa-clock" style="color: var(--warning);"></i> ${job.pending}</span>
          <span title="İlerleme">${progress.toFixed(0)}%</span>
        </div>
        <div class="job-details">
          <div class="job-detail-row">
            <span><i class="fas fa-users"></i> Toplam: ${job.total} alıcı</span>
            <span><i class="fas fa-calendar"></i> ${createdAt}</span>
          </div>
          ${job.type && job.type !== 'text' ? `<div class="job-detail-row"><span><i class="fas fa-file"></i> Tip: ${job.type}</span></div>` : ''}
        </div>
        <div class="job-actions">
          ${isActive ? `<button class="btn btn-warning btn-sm" data-action="pause" data-job-id="${job.jobId}" title="Duraklat"><i class="fas fa-pause"></i></button>` : ''}
          ${isPaused ? `<button class="btn btn-primary btn-sm" data-action="resume" data-job-id="${job.jobId}" title="Devam Et"><i class="fas fa-play"></i></button>` : ''}
          <button class="btn btn-secondary btn-sm" data-action="details" data-job-id="${job.jobId}" title="Detaylar"><i class="fas fa-info-circle"></i></button>
          ${!isCompleted ? `<button class="btn btn-danger btn-sm" data-action="cancel" data-job-id="${job.jobId}" title="İptal Et"><i class="fas fa-stop"></i></button>` : ''}
          ${isCompleted ? `<button class="btn btn-secondary btn-sm" data-action="delete" data-job-id="${job.jobId}" title="Sil"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </div>
    `;
  }

  async handleJobAction(action, jobId) {
    try {
      switch (action) {
        case 'pause':
          await api.pauseBulkJob(jobId);
          utils.toast('İş duraklatıldı', 'success');
          break;
        case 'resume':
          await api.resumeBulkJob(jobId);
          utils.toast('İş devam ediyor', 'success');
          break;
        case 'cancel':
          if (await utils.showConfirm('İşi iptal etmek istediğinize emin misiniz?')) {
            await api.cancelBulkJob(jobId);
            utils.toast('İş iptal edildi', 'success');
          }
          break;
        case 'delete':
          if (await utils.showConfirm('İşi silmek istediğinize emin misiniz?')) {
            await api.deleteBulkJob(jobId);
            utils.toast('İş silindi', 'success');
          }
          break;
        case 'details':
          await this.showJobDetails(jobId);
          return;
      }
      await this.loadBulkJobs();
    } catch (error) {
      utils.toast(error.message, 'error');
    }
  }

  async showJobDetails(jobId) {
    try {
      const response = await api.getBulkJobDetailedStatus(jobId);
      if (!response.success || !response.data) {
        utils.toast('İş detayları alınamadı', 'error');
        return;
      }

      const job = response.data;
      const recipients = job.recipients || [];

      const sent = recipients.filter(i => i.status === 'completed' || i.status === 'sent');
      const failed = recipients.filter(i => i.status === 'failed');
      const pending = recipients.filter(i => i.status === 'pending' || i.status === 'processing' || i.status === 'queued');

      let defaultTab = 'pending';
      let defaultList = pending;
      if (pending.length === 0 && sent.length > 0) {
        defaultTab = 'sent';
        defaultList = sent;
      } else if (pending.length === 0 && sent.length === 0 && failed.length > 0) {
        defaultTab = 'failed';
        defaultList = failed;
      }

      const statusLabels = {
        'queued': 'Kuyrukta',
        'processing': 'İşleniyor',
        'paused': 'Duraklatıldı',
        'completed': 'Tamamlandı',
        'failed': 'Başarısız',
        'cancelled': 'İptal Edildi'
      };
      const statusLabel = statusLabels[job.status] || job.status;

      const messageContent = job.message || job.caption || (job.mediaUrl ? `[${job.messageType?.toUpperCase() || 'MEDYA'}]` : '[Boş]');

      const modalHtml = `
        <div class="job-details-modal" id="job-details-modal">
          <div class="job-details-content">
            <div class="job-details-header">
              <h3><i class="fas fa-tasks"></i> İş Detayları</h3>
              <button class="close-btn" id="close-job-details"><i class="fas fa-times"></i></button>
            </div>
            <div class="job-details-body">
              <div class="job-info-grid">
                <div class="job-info-item">
                  <span class="label">İş ID</span>
                  <span class="value" title="${job.jobId}">${utils.truncate(job.jobId, 12)}</span>
                </div>
                <div class="job-info-item">
                  <span class="label">Durum</span>
                  <span class="value job-status ${utils.getStatusClass(job.status)}">${statusLabel}</span>
                </div>
                <div class="job-info-item">
                  <span class="label">Toplam</span>
                  <span class="value">${job.total} alıcı</span>
                </div>
                <div class="job-info-item">
                  <span class="label">Başarılı</span>
                  <span class="value" style="color: var(--success);">${job.success}</span>
                </div>
                <div class="job-info-item">
                  <span class="label">Başarısız</span>
                  <span class="value" style="color: var(--danger);">${job.failed}</span>
                </div>
                <div class="job-info-item">
                  <span class="label">Bekleyen</span>
                  <span class="value" style="color: var(--warning);">${job.pending}</span>
                </div>
              </div>
              
              <div class="job-message-section">
                <h4>Mesaj İçeriği</h4>
                <div class="job-message-content">${utils.escapeHtml(messageContent)}</div>
                ${job.mediaUrl ? `<div class="job-media-url"><small><i class="fas fa-link"></i> ${utils.truncate(job.mediaUrl, 40)}</small></div>` : ''}
              </div>

              <div class="job-recipients-section">
                <h4>Alıcı Listesi</h4>
                <div class="job-recipients-tabs">
                  <button class="tab-btn ${defaultTab === 'pending' ? 'active' : ''}" data-tab="pending">Bekleyen (${pending.length})</button>
                  <button class="tab-btn ${defaultTab === 'sent' ? 'active' : ''}" data-tab="sent">Gönderildi (${sent.length})</button>
                  <button class="tab-btn ${defaultTab === 'failed' ? 'active' : ''}" data-tab="failed">Başarısız (${failed.length})</button>
                </div>
                <div class="job-recipients-list" id="job-recipients-content">
                  ${this.renderJobRecipients(defaultList, defaultTab)}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', modalHtml);

      const tabData = { sent, failed, pending };

      document.getElementById('close-job-details').addEventListener('click', () => {
        document.getElementById('job-details-modal').remove();
      });

      document.querySelectorAll('.job-recipients-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          document.querySelectorAll('.job-recipients-tabs .tab-btn').forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');

          const tab = e.target.dataset.tab;
          const list = tabData[tab] || [];
          document.getElementById('job-recipients-content').innerHTML = this.renderJobRecipients(list, tab);
        });
      });

      document.getElementById('job-details-modal').addEventListener('click', (e) => {
        if (e.target.id === 'job-details-modal') {
          e.target.remove();
        }
      });

      const escHandler = (e) => {
        if (e.key === 'Escape') {
          document.getElementById('job-details-modal')?.remove();
          document.removeEventListener('keydown', escHandler);
        }
      };
      document.addEventListener('keydown', escHandler);
    } catch (error) {
      utils.toast('Detaylar yüklenemedi: ' + error.message, 'error');
    }
  }

  renderJobRecipients(items, type) {
    if (!items || items.length === 0) {
      return `<div class="empty-recipients">Bu kategoride alıcı yok</div>`;
    }

    return items.map(item => {
      const phone = item.phone || utils.formatJid(item.jid);
      const formattedPhone = utils.formatPhone(phone) || phone;
      const time = item.processedAt ? utils.formatDate(item.processedAt, 'time') : '';
      const statusIcon = type === 'sent' ? '<i class="fas fa-check" style="color: var(--success);"></i>' :
                         type === 'failed' ? '<i class="fas fa-times" style="color: var(--danger);"></i>' :
                         '<i class="fas fa-clock" style="color: var(--warning);"></i>';

      return `
        <div class="recipient-item ${type}">
          <span class="recipient-phone">${formattedPhone}</span>
          <span class="recipient-status">${statusIcon}</span>
          ${time ? `<span class="recipient-time">${time}</span>` : ''}
          ${item.error ? `<span class="recipient-error" title="${utils.escapeHtml(item.error)}"><i class="fas fa-exclamation-triangle"></i></span>` : ''}
        </div>
      `;
    }).join('');
  }

  async loadScheduledMessages() {
    try {
      const response = await api.getScheduledMessages();
      const container = document.getElementById('scheduled-list');

      if (response.success && response.data?.messages?.length > 0) {
        container.innerHTML = response.data.messages.map(msg => this.renderScheduledItem(msg)).join('');

        container.querySelectorAll('[data-action="cancel-scheduled"]').forEach(btn => {
          btn.addEventListener('click', () => this.cancelScheduledMessage(btn.dataset.id));
        });
      } else {
        container.innerHTML = `
          <div class="status-empty">
            <i class="fas fa-clock"></i>
            <span>Zamanlı mesaj yok</span>
          </div>
        `;
      }
    } catch (error) {
      console.error('Load scheduled error:', error);
    }
  }

  renderScheduledItem(msg) {
    const phone = utils.formatPhone(utils.formatJid(msg.jid)) || utils.formatJid(msg.jid);
    const preview = utils.formatMessagePreview(msg);
    const time = utils.formatDate(msg.scheduledAt, 'full');
    const statusClass = utils.getStatusClass(msg.status);
    const createdAt = utils.formatDate(msg.createdAt, 'full');

    const statusLabels = {
      'pending': 'Bekliyor',
      'sent': 'Gönderildi',
      'failed': 'Başarısız',
      'cancelled': 'İptal Edildi'
    };
    const statusLabel = statusLabels[msg.status] || msg.status;

    return `
      <div class="scheduled-item" data-id="${msg.id}">
        <div class="scheduled-item-header">
          <span class="scheduled-phone" title="${msg.jid}">${phone}</span>
          <span class="scheduled-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="scheduled-message" title="${utils.escapeHtml(msg.message || msg.caption || '')}">${utils.escapeHtml(preview)}</div>
        <div class="scheduled-details">
          <div class="scheduled-time">
            <i class="fas fa-calendar-alt"></i> Gönderim: ${time}
          </div>
          <div class="scheduled-created">
            <i class="fas fa-clock"></i> Oluşturulma: ${createdAt}
          </div>
          ${msg.type !== 'text' ? `<div class="scheduled-type"><i class="fas fa-file"></i> Tip: ${msg.type}</div>` : ''}
          ${msg.error ? `<div class="scheduled-error"><i class="fas fa-exclamation-triangle"></i> Hata: ${utils.escapeHtml(msg.error)}</div>` : ''}
          ${msg.messageId ? `<div class="scheduled-msgid"><i class="fas fa-check"></i> ID: ${msg.messageId.substring(0, 12)}...</div>` : ''}
        </div>
        ${msg.status === 'pending' ? `
          <div class="job-actions">
            <button class="btn btn-danger btn-sm" data-action="cancel-scheduled" data-id="${msg.id}">
              <i class="fas fa-times"></i> İptal
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  async cancelScheduledMessage(id) {
    if (!await utils.showConfirm('Zamanlı mesajı iptal etmek istiyor musunuz?')) return;

    try {
      await api.cancelScheduledMessage(id);
      utils.toast('Zamanlı mesaj iptal edildi', 'success');
      await this.loadScheduledMessages();
    } catch (error) {
      utils.toast(error.message, 'error');
    }
  }

  async clearCompletedScheduled() {
    if (!await utils.showConfirm('Tamamlanan zamanlı mesajları silmek istiyor musunuz?')) return;

    try {
      await api.clearCompletedScheduled();
      utils.toast('Zamanlı mesajlar temizlendi', 'success');
      await this.loadScheduledMessages();
    } catch (error) {
      utils.toast(error.message, 'error');
    }
  }

  async clearCompletedBulk() {
    if (!await utils.showConfirm('Tamamlanan toplu gönderileri silmek istiyor musunuz?')) return;

    try {
      await api.clearCompletedBulkJobs();
      utils.toast('Toplu gönderimler temizlendi', 'success');
      await this.loadBulkJobs();
    } catch (error) {
      utils.toast(error.message, 'error');
    }
  }

  startAutoRefresh() {
    setInterval(() => {
      this.checkConnectionHealth();
    }, 15000);

    setInterval(() => {
      if (this.state.isConnected) {
        switch (this.state.currentTab) {
          case 'dashboard':
            this.loadStats();
            break;
          case 'messaging':
            this.loadBulkJobs();
            break;
        }
      }
    }, 30000);
  }

  async checkConnectionHealth() {
    // Sunucu yapılandırılmadıysa hiç sorgulama yapma (gereksiz /auth/status polling önlenir).
    if (!this.state.apiReady) return;
    if (this._healthCheckInProgress) return;
    this._healthCheckInProgress = true;

    try {
      // Bağlı görünüyorsak: sunucu hâlâ bağlı mı diye doğrula.
      if (this.state.isConnected) {
        try {
          const response = await api.getStatus();
          if (response.success && response.data) {
            this.updateEncryptionAlert(response.data.encryptionAlert);
            if (!response.data.isConnected) {
              console.log('Connection lost detected in health check');
              this.state.isConnected = false;
              this.state.isConnecting = response.data.isConnecting || false;
              this.state.sessionInfo = null;
              if (!response.data.isConnecting) this.resetConnectButton();
              this.updateConnectionUI();
              utils.toast('WhatsApp bağlantısı kesildi', 'warning');
            }
          }
        } catch (apiError) {
          console.error('API unreachable during health check:', apiError);
          this.state.isConnected = false;
          this.state.isConnecting = false;
          this.state.apiReady = false;
          this.updateConnectionUI();
          this.updateApiStatusDot('error');
        }
        return;
      }

      // Bağlı değil görünüyoruz ama sunucu bağlıysa durumu düzelt.
      if (!this.state.isConnecting) {
        try {
          const response = await api.getStatus();
          if (response.success && response.data?.isConnected) {
            console.log('Actually connected, fixing state...');
            this.state.isConnected = true;
            this.state.sessionInfo = response.data.session;
            this.updateConnectionUI();
          }
        } catch {
        }
      }
    } catch (error) {
      console.error('Health check failed:', error);
    } finally {
      this._healthCheckInProgress = false;
    }
  }

  /** Şifreleme uyarı bandını gösterir/gizler (sunucudan gelen encryptionAlert). */
  updateEncryptionAlert(active) {
    const banner = document.getElementById('encryption-alert');
    if (banner) banner.classList.toggle('hidden', !active);
  }

  /** "Yeniden Bağlan": oturumu silmeden bağlantıyı yeniler (şifreleme kurtarma). */
  async reconnectEncryption() {
    try {
      await api.reconnect();
      utils.toast('Bağlantı yenileniyor, lütfen bekleyin...', 'info');
      this.updateEncryptionAlert(false);
      setTimeout(() => this.checkConnectionHealth(), 4000);
    } catch (error) {
      utils.toast('Yeniden bağlanma başlatılamadı', 'error');
    }
  }
}

let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new WhatsAppBOTApp();
  app.init();
});
