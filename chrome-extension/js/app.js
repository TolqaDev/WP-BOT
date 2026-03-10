/**
 * WhatsApp BOT Manager - Main Application
 * Redesigned for new UI/UX with SSE support
 */

class WhatsAppBOTApp {
  constructor() {
    this.state = {
      apiReady: false, // API bağlantısı doğrulandı mı
      isConnected: false,
      isConnecting: false,
      hasSession: false,
      sessionInfo: null,
      currentTab: 'chats',
      currentChatJid: null,
      currentChatFilter: 'all',
      newChatJid: null,
      messageType: 'single', // single or bulk
      singleScheduleMode: 'now', // now or later
      singleMessageType: 'text',
      unreadCount: 0,
      unreadChats: new Set()
    };
  }

  // ==================== INITIALIZATION ====================

  async init() {
    try {
      await api.init();
      await this.loadTheme();
      this.setupEventListeners();
      utils.initTooltips();
      await this.loadSettings();

      // API bağlantısını test et
      try {
        await this.checkConnection();
        this.state.apiReady = true;
        this.updateSidebarLock();

        if (this.state.isConnected) {
          this.hideConnectionOverlay();
          this.switchTab('chats');
          this.updateApiStatusDot('connected');
        } else {
          this.showConnectionOverlay();
          this.updateApiStatusDot('connected');
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

      // Always start SSE message stream when connected - regardless of active tab
      if (this.state.isConnected) {
        this.startGlobalMessageStream();
      }
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

  // ==================== EVENT LISTENERS ====================

  setupEventListeners() {
    // Sidebar navigation
    document.querySelectorAll('.sidebar-nav-item[data-tab]').forEach(item => {
      item.addEventListener('click', () => this.switchTab(item.dataset.tab));
    });

    // Theme toggle
    document.getElementById('theme-toggle')?.addEventListener('click', () => this.toggleTheme());

    // Sidebar API settings button
    document.getElementById('sidebar-api-settings')?.addEventListener('click', () => this.openApiModal());

    // API Settings Modal
    document.getElementById('api-settings-trigger')?.addEventListener('click', () => this.openApiModal());
    document.getElementById('api-modal-close')?.addEventListener('click', () => this.closeApiModal());
    document.getElementById('api-modal-backdrop')?.addEventListener('click', () => this.closeApiModal());
    document.getElementById('save-settings')?.addEventListener('click', () => this.saveSettings());
    document.getElementById('test-connection')?.addEventListener('click', () => this.testConnection());
    document.getElementById('toggle-api-key')?.addEventListener('click', () => this.toggleApiKeyVisibility());
    document.getElementById('add-server-btn')?.addEventListener('click', () => this.openApiModal('add-server'));

    // Modal tab switching
    document.querySelectorAll('.modal-tab[data-modal-tab]').forEach(tab => {
      tab.addEventListener('click', () => this.switchModalTab(tab.dataset.modalTab));
    });

    // Dashboard - Server Settings
    document.getElementById('save-server-settings')?.addEventListener('click', () => this.saveServerSettings());
    document.getElementById('refresh-server-settings')?.addEventListener('click', () => this.loadServerSettings());
    document.getElementById('retry-server-settings')?.addEventListener('click', () => this.loadServerSettings());

    // Cache management
    document.getElementById('chat-clear-cache-btn')?.addEventListener('click', () => this.clearCurrentChatCache());
    document.getElementById('clear-all-cache-btn')?.addEventListener('click', () => this.clearAllCachesAction());

    // Terminal Log Popup
    document.getElementById('terminal-log-btn')?.addEventListener('click', () => this.openTerminalPopup());
    document.getElementById('terminal-close-btn')?.addEventListener('click', () => this.closeTerminalPopup());
    document.getElementById('terminal-clear-btn')?.addEventListener('click', () => this.clearTerminalOutput());
    document.getElementById('terminal-scroll-btn')?.addEventListener('click', () => {
      const output = document.getElementById('terminal-output');
      if (output) output.scrollTop = output.scrollHeight;
    });

    // Typing Duration slider (stored in addon as ms, displayed as seconds)
    document.getElementById('typing-duration')?.addEventListener('input', (e) => {
      const sec = parseInt(e.target.value);
      const label = document.getElementById('typing-duration-value');
      if (label) label.textContent = sec === 0 ? 'Kapalı' : `${sec} sn`;
    });
    document.getElementById('typing-duration')?.addEventListener('change', (e) => {
      const sec = parseInt(e.target.value);
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ typingDuration: sec * 1000 });
      }
    });
    // Load saved typing duration
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['typingDuration'], (result) => {
        const ms = result.typingDuration || 0;
        const sec = Math.round(ms / 1000);
        const slider = document.getElementById('typing-duration');
        const label = document.getElementById('typing-duration-value');
        if (slider) slider.value = sec;
        if (label) label.textContent = sec === 0 ? 'Kapalı' : `${sec} sn`;
      });
    }

    // Sync PC time button
    document.getElementById('sync-pc-time')?.addEventListener('click', () => {
      const now = new Date();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const timezoneSelect = document.getElementById('server-timezone');
      if (timezoneSelect) {
        // Add timezone if not in list
        if (!timezoneSelect.querySelector(`option[value="${tz}"]`)) {
          const option = document.createElement('option');
          option.value = tz;
          option.textContent = tz;
          timezoneSelect.appendChild(option);
        }
        timezoneSelect.value = tz;
      }
      const timeEl = document.getElementById('server-time');
      if (timeEl) timeEl.textContent = now.toLocaleString('tr-TR', { timeZone: tz });
      utils.toast(`Saat dilimi ${tz} olarak ayarlandı`, 'success');
    });


    // Connection
    document.getElementById('connect-btn').addEventListener('click', () => this.connect());
    document.getElementById('disconnect-btn').addEventListener('click', () => this.disconnect());

    document.getElementById('refresh-stats')?.addEventListener('click', () => this.loadStats());

    // Chats Tab
    document.getElementById('chat-search').addEventListener('input',
      utils.debounce((e) => this.loadChats(e.target.value), 300)
    );
    document.querySelectorAll('.chat-filter-tab').forEach(tab => {
      tab.addEventListener('click', () => this.setChatsFilter(tab.dataset.filter));
    });
    document.getElementById('new-chat-btn').addEventListener('click', () => this.showNewChatPanel());
    document.getElementById('welcome-new-chat-btn').addEventListener('click', () => this.showNewChatPanel());

    // New Chat Panel
    document.getElementById('new-chat-back-btn').addEventListener('click', () => this.hideNewChatPanel());
    document.getElementById('new-chat-check-btn').addEventListener('click', () => this.checkNewChatNumber());
    document.getElementById('start-chat-btn').addEventListener('click', () => this.startNewChat());
    document.getElementById('new-chat-phone').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.checkNewChatNumber();
    });

    // Active Chat
    document.getElementById('chat-back-btn').addEventListener('click', () => this.closeChat());
    document.getElementById('chat-close-btn').addEventListener('click', () => this.closeChat());
    document.getElementById('chat-send-btn').addEventListener('click', () => this.sendChatMessage());
    document.getElementById('chat-message-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendChatMessage();
      }
    });

    // Auto-resize textarea
    const chatInput = document.getElementById('chat-message-input');
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
    });

    // Messaging Tab - Tab Switch
    document.querySelectorAll('.messaging-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchMessageType(tab.dataset.type));
    });

    // Single Message Form
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

    // Set min datetime
    const datetimeInput = document.getElementById('single-datetime');
    if (datetimeInput) {
      datetimeInput.min = utils.getMinScheduleDate();
      // Focus'a geldiğinde min'i güncelle
      datetimeInput.addEventListener('focus', () => {
        datetimeInput.min = utils.getMinScheduleDate();
      });
    }

    // Bulk Message Form - type selector buttons
    document.querySelectorAll('.type-option[data-bulk-type]').forEach(opt => {
      opt.addEventListener('click', () => this.setBulkMessageType(opt.dataset.bulkType));
    });
    document.getElementById('bulk-recipients').addEventListener('input', (e) => this.updateRecipientCount(e.target.value));
    document.getElementById('bulk-message').addEventListener('input', (e) => this.updateBulkCharCount(e.target.value));

    // Bulk time window toggle buttons
    document.querySelectorAll('.schedule-option[data-time-window]').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('.schedule-option[data-time-window]').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        const isOn = opt.dataset.timeWindow === 'on';
        document.getElementById('bulk-time-window').checked = isOn;
        utils.toggle('time-window-group', isOn);
      });
    });

    // Bulk schedule toggle buttons
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

    // Bulk datetime focus'ta min güncelle
    document.getElementById('bulk-start-datetime')?.addEventListener('focus', (e) => {
      e.target.min = utils.getMinScheduleDate();
    });
    document.getElementById('bulk-send-btn').addEventListener('click', () => this.handleBulkSend());


    // Refresh buttons
    document.getElementById('refresh-jobs').addEventListener('click', () => this.loadBulkJobs());
    document.getElementById('refresh-scheduled').addEventListener('click', () => this.loadScheduledMessages());
    document.getElementById('clear-completed-scheduled').addEventListener('click', () => this.clearCompletedScheduled());
    document.getElementById('clear-completed-bulk')?.addEventListener('click', () => this.clearCompletedBulk());
  }

  // ==================== TAB SWITCHING ====================

  switchTab(tabId) {
    // API bağlantısı yoksa hiçbir tab'a izin verme
    if (!this.state.apiReady) {
      utils.toast('Önce API bağlantısını yapılandırın', 'warning');
      return;
    }

    // WhatsApp bağlı değilse hiçbir tab'a izin verme
    if (!this.state.isConnected) {
      utils.toast('WhatsApp bağlı değil. Önce bağlantı kurun.', 'warning');
      return;
    }

    // Update sidebar nav
    document.querySelectorAll('.sidebar-nav-item[data-tab]').forEach(item => {
      item.classList.toggle('active', item.dataset.tab === tabId);
    });

    // Update content
    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.classList.toggle('active', tab.id === `tab-${tabId}`);
    });

    // Update page title
    const titles = {
      'chats': 'Sohbetler',
      'messaging': 'Mesaj Gönderimi',
      'dashboard': 'Kontrol Paneli'
    };
    document.getElementById('page-title').textContent = titles[tabId] || tabId;

    this.state.currentTab = tabId;

    // Stop chat-specific SSE stream when leaving chats tab to prevent read receipts
    // Also close the chat detail view so it resets properly
    if (tabId !== 'chats' && this.state.currentChatJid) {
      this.closeChat();
    }

    // Load tab data
    switch (tabId) {
      case 'chats':
        this.loadChats();
        break;
      case 'messaging':
        this.loadBulkJobs();
        this.loadScheduledMessages();
        break;
      case 'dashboard':
        this.loadDashboardData();
        break;
    }
  }

  // ==================== CONNECTION ====================

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

        if (this.state.isConnected) {
          await this.loadDashboardData();
          await this.loadChats();
        } else if (response.data.hasSession && !response.data.isConnecting) {
          // Kayıtlı oturum var ama bağlı değil - otomatik bağlanıyor olabilir
          this.updateLoadingStatus('Kayıtlı oturum bulundu, bağlanıyor...');

          // Birkaç saniye bekleyip tekrar kontrol et
          await new Promise(resolve => setTimeout(resolve, 3000));

          const retryResponse = await api.getStatus();
          if (retryResponse.success && retryResponse.data) {
            this.state.isConnected = retryResponse.data.isConnected;
            this.state.isConnecting = retryResponse.data.isConnecting || false;
            this.state.sessionInfo = retryResponse.data.session;
            this.updateConnectionUI();

            if (retryResponse.data.isConnected) {
              await this.loadDashboardData();
              await this.loadChats();
            } else if (retryResponse.data.isConnecting) {
              // Hala bağlanıyor - UI bunu gösterecek
              this.updateLoadingStatus('Bağlanıyor...');
            }
          }
        } else if (response.data.isConnecting) {
          // Aktif bağlantı girişimi var
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


    // Connection badge in header
    const badge = document.getElementById('connection-status');
    const badgeText = badge.querySelector('.badge-text');
    badge.classList.remove('connected', 'connecting', 'disconnected');

    if (isConnected) {
      badge.classList.add('connected');
      badgeText.textContent = 'Bağlı';

      // Start global message stream when connected
      if (!api.isMessageStreamActive()) {
        this.startGlobalMessageStream();
      }
    } else if (isConnecting) {
      badge.classList.add('connecting');
      badgeText.textContent = 'Bağlanıyor...';

      // Bağlanırken connect butonunu disable yap
      const connectBtn = document.getElementById('connect-btn');
      if (connectBtn && !connectBtn.disabled) {
        connectBtn.disabled = true;
        connectBtn.innerHTML = '<span class="spinner"></span> Bağlanıyor...';
      }
    } else {
      badge.classList.add('disconnected');
      badgeText.textContent = 'Bağlı Değil';

      // Stop streams when disconnected
      this.stopGlobalMessageStream();
      this.stopChatStream();

      // Connect butonunu resetle
      this.resetConnectButton();
    }

    // Connection overlay
    if (isConnected) {
      this.hideConnectionOverlay();
    } else {
      this.showConnectionOverlay();
    }

    // Dashboard connected view
    const connectedView = document.getElementById('dashboard-connected-view');
    const qrPlaceholder = document.getElementById('qr-placeholder');
    const qrImage = document.getElementById('qr-image');

    if (isConnected) {
      utils.show(connectedView);

      if (sessionInfo) {
        document.getElementById('session-name').textContent = sessionInfo.name || 'WhatsApp Kullanıcısı';
        document.getElementById('session-phone').textContent = utils.formatPhone(sessionInfo.phone);
      }

      // Update API info display in connected dashboard
      this.updateApiInfoDisplay();
      this.updateApiStatusDot('connected');

      // Bağlandığında sunucu ayarlarını yükle
      this.loadServerSettings();
    } else {
      utils.hide(connectedView);

      if (!isConnecting) {
        utils.show(qrPlaceholder);
        qrImage.classList.add('hidden');
        qrImage.src = '';
      }
    }

    // Sidebar kilit durumunu güncelle
    this.updateSidebarLock();
  }

  async connect() {
    // Check if any API server is configured
    const servers = await this.getSavedServers();
    if (servers.length === 0 && !this.state.apiReady) {
      utils.toast('Önce bir sunucu eklemeniz gerekiyor', 'warning');
      this.openApiModal('add-server');
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

      // Bağlantı stabilizasyon kontrolü için flag
      let connectionReceived = false;
      let stabilizationCheckTimer = null;

      // Start QR stream
      api.startQRStream(
        // onQR
        (qrCode) => {
          const qrImg = document.getElementById('qr-image');
          const qrPlaceholder = document.getElementById('qr-placeholder');
          qrImg.src = qrCode;
          qrImg.classList.remove('hidden');
          utils.hide(qrPlaceholder);

          // QR gösteriliyorsa hala bağlanıyor demek
          this.state.isConnecting = true;
          this.state.isConnected = false;
        },
        // onConnected
        async (session) => {
          console.log('QR Stream connected event received:', session);
          connectionReceived = true;

          // İlk olarak UI'ı bağlanıyor olarak güncelle
          this.state.isConnecting = true;
          this.state.isConnected = false;
          this.state.sessionInfo = session;

          const connectBtn = document.getElementById('connect-btn');
          if (connectBtn) {
            connectBtn.disabled = true;
            connectBtn.innerHTML = '<span class="spinner"></span> Senkronize ediliyor...';
          }

          utils.toast('WhatsApp senkronize ediliyor, lütfen bekleyin...', 'info');

          // WhatsApp bağlandıktan sonra senkronizasyon bekletmesi olabilir (515 error)
          // Bunun için 5-10 saniye içinde durumu kontrol et
          const checkStability = async (attempt = 1) => {
            try {
              const statusResponse = await api.getStatus();
              if (statusResponse.success && statusResponse.data) {
                if (statusResponse.data.isConnected) {
                  // Gerçekten bağlandı!
                  this.state.isConnecting = false;
                  this.state.isConnected = true;
                  this.state.sessionInfo = statusResponse.data.session || session;
                  this.state.hasSession = true;

                  this.resetConnectButton();
                  this.updateConnectionUI();
                  utils.toast('WhatsApp bağlandı!', 'success');

                  this.loadDashboardData();
                  this.loadChats();
                  return true;
                } else if (statusResponse.data.isConnecting && attempt < 6) {
                  // Hala bağlanıyor - bekle ve tekrar kontrol et
                  console.log(`Still connecting, attempt ${attempt}/6, checking again in 3s...`);
                  setTimeout(() => checkStability(attempt + 1), 3000);
                  return false;
                } else {
                  // Bağlantı başarısız
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

          // İlk kontrol 3 saniye sonra
          stabilizationCheckTimer = setTimeout(() => checkStability(1), 3000);
        },
        // onError
        (error) => {
          console.error('QR Stream error:', error);
          // SSE hatası aldık ama bağlantı gerçekleşmiş olabilir
          // connectionReceived true ise, stabilization check devam edecek
          if (!connectionReceived) {
            this.state.isConnecting = false;
            this.updateConnectionUI();
            this.resetConnectButton();
          }
        },
        // onDisconnected
        (reason) => {
          console.log('QR Stream disconnected:', reason);

          // Eğer bağlantı sağlandıysa ve senkronizasyon devam ediyorsa, görmezden gel
          if (connectionReceived && this.state.isConnecting) {
            console.log('Ignoring disconnect during stabilization');
            return;
          }

          this.state.isConnecting = false;
          this.state.isConnected = false;
          this.updateConnectionUI();
          this.resetConnectButton();

          if (reason && reason !== 'Connection cancelled by user') {
            // API'den gerçek durumu kontrol et
            api.getStatus().then(response => {
              if (response.success && response.data?.isConnected) {
                // Aslında bağlı!
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
        // onTimeout
        () => {
          console.log('QR Stream timeout');
          this.state.isConnecting = false;
          this.updateConnectionUI();
          this.resetConnectButton();
          utils.toast('QR kod süresi doldu. Tekrar deneyin.', 'warning');
        },
        // onReconnecting
        (data) => {
          console.log('QR Stream reconnecting:', data);
          this.state.isConnecting = true;
          this.state.isConnected = false;

          const connectBtn = document.getElementById('connect-btn');
          if (connectBtn) {
            connectBtn.disabled = true;
            connectBtn.innerHTML = `<span class="spinner"></span> Yeniden bağlanıyor (${data.attempt})...`;
          }

          // QR placeholder'da bilgi göster
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

      // Also try REST endpoint for immediate QR
      try {
        const response = await api.getQR();
        if (response.success && response.data?.qrCode) {
          const qrImg = document.getElementById('qr-image');
          const qrPlaceholder = document.getElementById('qr-placeholder');
          qrImg.src = response.data.qrCode;
          qrImg.classList.remove('hidden');
          utils.hide(qrPlaceholder);
        } else if (response.data?.isConnected) {
          this.state.isConnecting = false;
          this.state.isConnected = true;
          this.state.sessionInfo = response.data.session;
          this.updateConnectionUI();
          this.resetConnectButton();
          api.stopQRStream();
          utils.toast('WhatsApp bağlandı!', 'success');
        }
      } catch (restError) {
        // REST endpoint hatası - SSE devam ediyor
        console.log('REST QR endpoint failed, SSE will handle it');
      }
    } catch (error) {
      console.error('Connect error:', error);
      this.state.isConnecting = false;
      this.updateConnectionUI();
      utils.toast(error.message, 'error');

      this.resetConnectButton();
    }
  }

  /**
   * Reset connect button to default state
   */
  resetConnectButton() {
    const connectBtn = document.getElementById('connect-btn');
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.innerHTML = '<i class="fas fa-plug"></i> Bağlantıyı Başlat';
    }
  }

  async disconnect() {
    if (!await utils.showConfirm('WhatsApp oturumundan çıkmak istediğinize emin misiniz?')) return;

    try {
      utils.setLoading('disconnect-btn', true, 'Çıkış...');

      // Önce tüm stream'leri durdur
      this.stopGlobalMessageStream();
      this.stopChatStream();
      api.stopQRStream();

      await api.logout();

      this.state.isConnected = false;
      this.state.isConnecting = false;
      this.state.sessionInfo = null;
      this.state.hasSession = false;

      // Connect butonunu resetle
      this.resetConnectButton();

      // QR placeholder'ı göster, image'ı gizle
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
      utils.toast(error.message, 'error');

      // Hata durumunda da durumu güncelle
      this.state.isConnected = false;
      this.state.isConnecting = false;
      this.state.hasSession = false;
      this.updateConnectionUI();

      this.resetConnectButton();

      // QR alanını resetle
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

  // ==================== SETTINGS ====================

  // ==================== CONNECTION OVERLAY & API MODAL ====================

  /**
   * Show connection overlay (full-screen QR view)
   */
  showConnectionOverlay() {
    const overlay = document.getElementById('connection-overlay');
    if (overlay) overlay.classList.add('active');
  }

  /**
   * Hide connection overlay
   */
  hideConnectionOverlay() {
    const overlay = document.getElementById('connection-overlay');
    if (overlay) overlay.classList.remove('active');
  }

  /**
   * Open API settings modal with animation
   * @param {string} tab - 'servers' or 'add-server'
   */
  openApiModal(tab = 'servers', prefillData = null) {
    const backdrop = document.getElementById('api-modal-backdrop');
    const modal = document.getElementById('api-modal');
    if (!backdrop || !modal) return;

    backdrop.classList.remove('hidden');
    modal.classList.remove('hidden');

    // Trigger animation after DOM update
    requestAnimationFrame(() => {
      backdrop.classList.add('visible');
      modal.classList.add('visible');
    });

    // Switch to requested tab (this clears the form if add-server)
    this.switchModalTab(tab);

    // Pre-fill form data AFTER clearing (for edit mode)
    if (prefillData) {
      const urlInput = document.getElementById('api-url');
      const keyInput = document.getElementById('api-key');
      if (urlInput) urlInput.value = prefillData.url || '';
      if (keyInput) keyInput.value = prefillData.key || '';
    }

    // Update modal status dot
    this.updateApiModalStatus();

    // Render saved servers in modal
    this.renderModalServerList();
  }

  /**
   * Switch modal tabs
   */
  switchModalTab(tabName) {
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));

    const tab = document.querySelector(`.modal-tab[data-modal-tab="${tabName}"]`);
    const content = document.getElementById(`modal-tab-${tabName}`);
    if (tab) tab.classList.add('active');
    if (content) content.classList.add('active');

    // Clear add-server form inputs when switching to that tab
    if (tabName === 'add-server') {
      this.clearAddServerForm();
    }
  }

  /**
   * Clear add-server form inputs
   */
  clearAddServerForm() {
    const urlInput = document.getElementById('api-url');
    const keyInput = document.getElementById('api-key');
    if (urlInput) urlInput.value = '';
    if (keyInput) keyInput.value = '';
  }

  /**
   * Close API settings modal with animation
   */
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

  /**
   * Update API modal status indicator
   */
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

  /**
   * Clear API settings from storage and reset UI
   */
  async clearApiSettings() {
    if (!await utils.showConfirm('API bağlantı bilgileri silinecek. Devam etmek istiyor musunuz?')) return;

    // Clear from chrome storage
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.remove(['apiUrl', 'apiKey'], () => {
        utils.toast('API bilgileri temizlendi', 'success');
      });
    } else {
      localStorage.removeItem('apiUrl');
      localStorage.removeItem('apiKey');
      utils.toast('API bilgileri temizlendi', 'success');
    }

    // Clear input fields
    const urlInput = document.getElementById('api-url');
    const keyInput = document.getElementById('api-key');
    if (urlInput) urlInput.value = '';
    if (keyInput) keyInput.value = '';

    // Reset API state
    this.state.apiReady = false;
    this.state.isConnected = false;
    api.baseUrl = '';
    api.apiKey = '';

    // Stop all active streams
    this.stopGlobalMessageStream();
    this.stopChatStream();

    // Update status dot
    this.updateApiStatusDot('');

    // Update connection UI
    this.updateConnectionUI();

    // Update sidebar locks
    this.updateSidebarLock();

    // Show connection overlay
    this.showConnectionOverlay();

    // Close modal if open and reopen for re-entry
    this.closeApiModal();
    setTimeout(() => this.openApiModal(), 400);
  }

  /**
   * Update the API status dot indicator
   */
  updateApiStatusDot(status) {
    // Update trigger button dot
    const triggerDot = document.getElementById('api-trigger-dot');
    if (triggerDot) {
      triggerDot.classList.remove('connected', 'error');
      if (status === 'connected') triggerDot.classList.add('connected');
      else if (status === 'error') triggerDot.classList.add('error');
    }

    // Update modal status dot
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

  /**
   * Update API info display - render server lists in dashboard and modal
   */
  updateApiInfoDisplay() {
    this.renderServerList();
    this.renderModalServerList();
  }

  /**
   * Load saved servers from storage
   */
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

  /**
   * Save servers to storage
   */
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

  /**
   * Add or update a server in saved list
   */
  async addOrUpdateServer(url, key, name = null) {
    const servers = await this.getSavedServers();
    const existing = servers.findIndex(s => s.url === url);
    const serverName = name || new URL(url).hostname || 'Sunucu';

    if (existing >= 0) {
      servers[existing] = { ...servers[existing], url, key, name: serverName, updatedAt: Date.now() };
    } else {
      servers.push({ id: Date.now().toString(), url, key, name: serverName, createdAt: Date.now(), updatedAt: Date.now() });
    }

    await this.saveServers(servers);
    this.updateApiInfoDisplay();
  }

  /**
   * Remove server from saved list
   */
  async removeServer(serverId) {
    if (!await utils.showConfirm('Bu sunucuyu listeden kaldırmak istiyor musunuz?')) return;
    const servers = await this.getSavedServers();
    const filtered = servers.filter(s => s.id !== serverId);
    await this.saveServers(filtered);

    // If removing active server, clear connection
    const removed = servers.find(s => s.id === serverId);
    if (removed && removed.url === api.baseUrl) {
      this.clearApiSettings();
    } else {
      this.updateApiInfoDisplay();
    }
  }

  /**
   * Switch to a different server
   */
  async switchServer(serverId) {
    const servers = await this.getSavedServers();
    const server = servers.find(s => s.id === serverId);
    if (!server) return;

    // Stop current streams
    this.stopGlobalMessageStream();
    this.stopChatStream();

    // Update API settings
    await api.saveSettings(server.url, server.key);

    // Test connection
    try {
      await this.checkConnection();
      this.state.apiReady = true;
      this.updateSidebarLock();

      if (this.state.isConnected) {
        this.hideConnectionOverlay();
        this.closeApiModal();
        this.switchTab('chats');
        this.updateApiStatusDot('connected');
        utils.toast(`${server.name} sunucusuna bağlandı`, 'success');
      } else {
        this.showConnectionOverlay();
        this.updateApiStatusDot('connected');
        utils.toast(`${server.name} API bağlı, WhatsApp bağlantısı bekleniyor`, 'info');
      }
    } catch (e) {
      this.state.apiReady = false;
      this.updateSidebarLock();
      this.updateApiStatusDot('error');
      utils.toast(`${server.name} sunucusuna bağlanılamadı`, 'error');
    }

    this.updateApiInfoDisplay();
  }

  /**
   * Render server list in dashboard
   */
  async renderServerList() {
    const container = document.getElementById('server-list');
    if (!container) return;

    const servers = await this.getSavedServers();
    const currentUrl = api.baseUrl;

    // Ensure current active server is in the list
    if (currentUrl && !servers.find(s => s.url === currentUrl)) {
      await this.addOrUpdateServer(currentUrl, api.apiKey);
      return; // addOrUpdateServer calls updateApiInfoDisplay which calls this again
    }

    if (servers.length === 0) {
      container.innerHTML = `
        <div class="server-empty">
          <i class="fas fa-server"></i>
          <span>Kayıtlı sunucu yok</span>
          <button class="btn btn-primary btn-sm" id="empty-add-server"><i class="fas fa-plus"></i> Sunucu Ekle</button>
        </div>`;
      document.getElementById('empty-add-server')?.addEventListener('click', () => this.openApiModal());
      return;
    }

    container.innerHTML = servers.map(server => {
      const isActive = server.url === currentUrl;
      const displayUrl = (() => { try { return new URL(server.url).host; } catch { return server.url; } })();
      return `
        <div class="server-item ${isActive ? 'active' : ''}" data-id="${server.id}">
          <div class="server-item-indicator ${isActive ? 'connected' : ''}"></div>
          <div class="server-item-info">
            <span class="server-item-name">${utils.escapeHtml(server.name)}</span>
            <span class="server-item-url">${utils.escapeHtml(displayUrl)}</span>
          </div>
          <div class="server-item-actions">
            ${!isActive ? `<button class="icon-btn-sm server-switch-btn" data-id="${server.id}" title="Bağlan"><i class="fas fa-plug"></i></button>` : ''}
            <button class="icon-btn-sm server-edit-btn" data-id="${server.id}" title="Düzenle"><i class="fas fa-pen"></i></button>
            <button class="icon-btn-sm server-delete-btn" data-id="${server.id}" title="Sil"><i class="fas fa-trash"></i></button>
          </div>
        </div>`;
    }).join('');

    // Event listeners
    container.querySelectorAll('.server-switch-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.switchServer(btn.dataset.id); });
    });
    container.querySelectorAll('.server-edit-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const servers = await this.getSavedServers();
        const server = servers.find(s => s.id === btn.dataset.id);
        if (server) {
          this.openApiModal('add-server', { url: server.url, key: server.key });
        }
      });
    });
    container.querySelectorAll('.server-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.removeServer(btn.dataset.id); });
    });
  }

  /**
   * Render server list in API modal - click to switch directly
   */
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

    container.innerHTML = `<div class="modal-servers-label">Kayıtlı Sunucular</div>` + servers.map(server => {
      const isActive = server.url === currentUrl;
      const displayUrl = (() => { try { return new URL(server.url).host; } catch { return server.url; } })();
      return `
        <div class="modal-server-item ${isActive ? 'active' : ''}" data-id="${server.id}">
          <div class="modal-server-dot ${isActive ? 'connected' : ''}"></div>
          <div class="modal-server-info">
            <span class="modal-server-name">${utils.escapeHtml(server.name)}</span>
            <span class="modal-server-url">${utils.escapeHtml(displayUrl)}</span>
          </div>
          ${isActive ? '<span class="modal-server-active-tag"><i class="fas fa-check"></i> Aktif</span>' : '<span class="modal-server-connect-tag"><i class="fas fa-plug"></i> Bağlan</span>'}
          <button class="modal-server-delete" data-id="${server.id}" title="Sil"><i class="fas fa-times"></i></button>
        </div>`;
    }).join('');

    // Click to switch server (not active ones)
    container.querySelectorAll('.modal-server-item:not(.active)').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.modal-server-delete')) return;
        this.switchServer(item.dataset.id);
      });
    });

    // Delete button
    container.querySelectorAll('.modal-server-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeServer(btn.dataset.id);
      });
    });
  }

  /**
   * Sidebar kilitlenmesini güncelle - API yoksa diğer tab'lar disabled
   */
  updateSidebarLock() {
    const canNavigate = this.state.apiReady && this.state.isConnected;
    const tabTitles = { 'chats': 'Sohbetler', 'messaging': 'Mesaj Gönderimi', 'dashboard': 'Kontrol Paneli' };
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

  // ==================== THEME ====================

  toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);

    // Update icon - show the mode you can switch TO
    const icon = document.querySelector('#theme-toggle i');
    if (icon) {
      icon.className = next === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }

    // Save preference
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

        // Populate form fields
        const timezoneSelect = document.getElementById('server-timezone');
        if (timezoneSelect) {
          timezoneSelect.value = data.timezone || 'Europe/Istanbul';
          // Add timezone if not in list
          if (!timezoneSelect.querySelector(`option[value="${data.timezone}"]`)) {
            const option = document.createElement('option');
            option.value = data.timezone;
            option.textContent = data.timezone;
            timezoneSelect.appendChild(option);
            timezoneSelect.value = data.timezone;
          }
        }

        document.getElementById('server-auto-read').checked = data.autoRead || false;
        document.getElementById('server-notify').checked = data.notify || false;
        document.getElementById('server-call-reject').checked = data.callReject?.enabled || false;

        // Load cache clear interval
        const cacheIntervalSelect = document.getElementById('server-cache-clear-interval');
        if (cacheIntervalSelect) {
          cacheIntervalSelect.value = String(data.cacheClearInterval || 0);
        }

        // Show server time
        const timeEl = document.getElementById('server-time');
        if (timeEl && data.time) {
          timeEl.textContent = data.time.localTime || data.time.currentTime || '-';
        } else if (timeEl) {
          // If no time in response, show local time as fallback
          const tz = data.timezone || 'Europe/Istanbul';
          try {
            timeEl.textContent = new Date().toLocaleString('tr-TR', { timeZone: tz });
          } catch { timeEl.textContent = new Date().toLocaleString('tr-TR'); }
        }

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
    const btn = document.getElementById('save-server-settings');

    try {
      utils.setLoading('save-server-settings', true);

      const settings = {
        timezone: document.getElementById('server-timezone').value,
        autoRead: document.getElementById('server-auto-read').checked,
        notify: document.getElementById('server-notify').checked,
        callReject: {
          enabled: document.getElementById('server-call-reject').checked
        },
        cacheClearInterval: parseInt(document.getElementById('server-cache-clear-interval')?.value || '0', 10)
      };

      const response = await api.updateAppSettings(settings);

      if (response.success) {
        utils.toast('Sunucu ayarları kaydedildi', 'success');
        // Refresh to show updated time
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

  async clearCurrentChatCache() {
    if (!this.state.currentChatJid) return;

    if (!await utils.showConfirm('Bu sohbetin önbelleğini temizlemek istediğinize emin misiniz?')) return;

    try {
      const response = await api.clearChatCache(this.state.currentChatJid);
      if (response.success) {
        utils.toast(`Sohbet önbelleği temizlendi (${response.data?.clearedMessages || 0} mesaj)`, 'success');
        // Close the chat view and go back to chat list
        this.closeChat();
        // Reload chats list to reflect changes
        await this.loadChats();
      } else {
        throw new Error(response.message || 'Önbellek temizlenemedi');
      }
    } catch (error) {
      console.error('Clear chat cache error:', error);
      utils.toast('Önbellek temizlenemedi: ' + error.message, 'error');
    }
  }

  async clearAllCachesAction() {
    if (!await utils.showConfirm('Tüm sohbet önbelleğini temizlemek istediğinize emin misiniz?\nBu işlem geri alınamaz.')) return;

    try {
      utils.setLoading('clear-all-cache-btn', true, 'Temizleniyor...');
      const response = await api.clearAllCaches();
      if (response.success) {
        const data = response.data || {};
        utils.toast(`Tüm önbellek temizlendi (${data.clearedChats || 0} sohbet, ${data.clearedMessages || 0} mesaj)`, 'success');
        // Reload chats list
        await this.loadChats();
      } else {
        throw new Error(response.message || 'Önbellek temizlenemedi');
      }
    } catch (error) {
      console.error('Clear all caches error:', error);
      utils.toast('Önbellek temizlenemedi: ' + error.message, 'error');
    } finally {
      utils.setLoading('clear-all-cache-btn', false);
    }
  }

  // ==================== TERMINAL LOG POPUP ====================

  openTerminalPopup() {
    const popup = document.getElementById('terminal-popup');
    const status = document.getElementById('terminal-status');
    const output = document.getElementById('terminal-output');

    if (!popup) return;

    // Show popup
    popup.classList.remove('hidden');

    // Reset state
    status.className = 'terminal-popup-status';
    status.innerHTML = '<span class="terminal-status-dot"></span><span>Bağlanıyor...</span>';
    output.innerHTML = '<div class="terminal-empty"><i class="fas fa-terminal"></i><span>Log akışı başlatılıyor...</span></div>';

    // Auto-scroll flag
    this._terminalAutoScroll = true;

    // Track scroll to determine auto-scroll behavior
    output.addEventListener('scroll', () => {
      const atBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
      this._terminalAutoScroll = atBottom;
    });

    // Start SSE stream
    api.startTerminalStream(
      // onLog
      (logEntry) => {
        this.appendTerminalLog(logEntry);
      },
      // onOpen
      () => {
        status.className = 'terminal-popup-status connected';
        status.innerHTML = '<span class="terminal-status-dot"></span><span>Bağlı — Canlı log akışı</span>';
        // Clear empty state
        const empty = output.querySelector('.terminal-empty');
        if (empty) empty.remove();
      },
      // onError
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

    // Stop SSE stream
    api.stopTerminalStream();
  }

  clearTerminalOutput() {
    const output = document.getElementById('terminal-output');
    if (output) {
      output.innerHTML = '<div class="terminal-empty"><i class="fas fa-terminal"></i><span>Log temizlendi</span></div>';
    }
  }

  appendTerminalLog(entry) {
    const output = document.getElementById('terminal-output');
    if (!output) return;

    // Remove empty state if exists
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

    // Data tooltip on click
    if (hasData) {
      const dataBtn = line.querySelector('.terminal-data');
      dataBtn?.addEventListener('click', () => {
        const formatted = JSON.stringify(entry.data, null, 2);
        const pre = document.createElement('div');
        pre.style.cssText = 'padding:4px 8px;margin:2px 0 4px 100px;background:var(--bg-input);border-radius:4px;font-size:10px;color:var(--text-secondary);white-space:pre-wrap;word-break:break-all;border:1px solid var(--border)';
        pre.textContent = formatted;
        // Toggle
        if (line.nextElementSibling?.dataset?.dataExpanded) {
          line.nextElementSibling.remove();
        } else {
          pre.dataset.dataExpanded = 'true';
          line.after(pre);
        }
      });
    }

    output.appendChild(line);

    // Keep max 500 lines
    while (output.children.length > 500) {
      output.removeChild(output.firstChild);
    }

    // Auto scroll if at bottom
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
      await api.saveSettings(url, key);

      // Save to multi-server list
      await this.addOrUpdateServer(url, key);

      utils.toast('API ayarları kaydedildi', 'success');

      // Clear add-server form
      this.clearAddServerForm();

      // API bağlantısını test et
      try {
        await this.checkConnection();
        this.state.apiReady = true;
        this.updateSidebarLock();

        if (this.state.isConnected) {
          this.closeApiModal();
          this.hideConnectionOverlay();
          this.switchTab('chats');
          this.updateApiStatusDot('connected');
        } else {
          this.closeApiModal();
          this.showConnectionOverlay();
          this.updateApiStatusDot('connected');
        }
      } catch (e) {
        // API bağlantısı yok ama ayarlar kaydedildi
        this.state.apiReady = false;
        this.updateSidebarLock();
        this.updateApiStatusDot('error');
      }
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

  // ==================== DASHBOARD ====================

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

        // System stats
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

        // Stat cards
        const statChats = document.getElementById('stat-chats');
        const statMessages = document.getElementById('stat-messages');
        const statJobs = document.getElementById('stat-jobs');

        if (statChats) statChats.textContent = data.messages?.totalChats || 0;
        if (statMessages) statMessages.textContent = data.messages?.totalMessages || 0;
        if (statJobs) statJobs.textContent = data.queue?.activeJobs || 0;

        // WhatsApp Stats
        const waConnectionTime = document.getElementById('wa-connection-time');
        const waSentToday = document.getElementById('wa-sent-today');
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

        if (waSentToday) {
          const totalMessages = data.messages?.totalMessages || 0;
          waSentToday.textContent = `${totalMessages} mesaj`;
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

  // ==================== CHATS ====================

  async loadChats(search = null) {
    try {
      const searchText = search ?? document.getElementById('chat-search')?.value;
      const filter = this.state.currentChatFilter;

      const filters = {
        limit: 50,
        search: searchText || undefined,
        unread: filter === 'unread' ? true : undefined
      };

      const response = await api.getChats(filters);
      const container = document.getElementById('chats-list');

      if (response.success && response.data?.chats?.length > 0) {
        container.innerHTML = response.data.chats.map(chat => this.renderChatItem(chat)).join('');

        // Add click handlers
        container.querySelectorAll('.chat-item').forEach(item => {
          item.addEventListener('click', () => this.openChat(item.dataset.jid));
        });

        // Sync unread chats from API data - count chats with unread, not total messages
        response.data.chats.forEach(c => {
          if (c.unreadCount > 0) {
            this.state.unreadChats.add(c.jid);
          }
        });
        this.updateUnreadBadge();
      } else {
        container.innerHTML = `
          <div class="chats-empty">
            <i class="fas fa-comments"></i>
            <p>${filter === 'unread' ? 'Okunmamış mesaj yok' : 'Sohbet bulunamadı'}</p>
          </div>
        `;
      }
    } catch (error) {
      console.error('Load chats error:', error);

      // Rate limit hatasını özel olarak işle
      const container = document.getElementById('chats-list');
      if (error.message && (error.message.includes('Rate limit') || error.message.includes('Çok fazla istek'))) {
        // Rate limit için sessizce bekle, UI'ı bozmadan
        console.log('Rate limit hit while loading chats, will retry later');
      } else {
        container.innerHTML = `
          <div class="chats-empty">
            <i class="fas fa-exclamation-triangle"></i>
            <p>Sohbetler yüklenemedi</p>
            <small>${utils.escapeHtml(error.message)}</small>
          </div>
        `;
      }
    }
  }

  renderChatItem(chat) {
    // İsim yoksa veya "Ben" ise telefon numarasını göster
    let name = chat.name;
    if (!name || name === 'Ben' || name === 'BEN') {
      name = utils.formatPhone(chat.phone) || utils.formatJid(chat.jid);
    }
    const lastMsg = utils.formatMessagePreview(chat.lastMessage);
    const time = utils.formatDate(chat.lastMessageAt, 'short');
    const initial = (name || '?').charAt(0).toUpperCase();
    const isActive = this.state.currentChatJid === chat.jid;
    const hasUnread = chat.unreadCount > 0;

    return `
      <div class="chat-item ${isActive ? 'active' : ''}" data-jid="${chat.jid}">
        <div class="chat-item-avatar">${initial}</div>
        <div class="chat-item-content">
          <div class="chat-item-header">
            <span class="chat-item-name">${utils.escapeHtml(name)}</span>
            <span class="chat-item-time ${hasUnread ? 'unread' : ''}">${time}</span>
          </div>
          <div class="chat-item-preview">
            <span class="chat-item-message">${utils.escapeHtml(lastMsg)}</span>
            ${hasUnread ? `<span class="chat-item-badge">${chat.unreadCount}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  setChatsFilter(filter) {
    this.state.currentChatFilter = filter;

    document.querySelectorAll('.chat-filter-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.filter === filter);
    });

    this.loadChats();
  }

  // ==================== NEW CHAT ====================

  showNewChatPanel() {
    utils.hide('chat-welcome');
    utils.hide('chat-active-view');
    utils.show('new-chat-panel');
    document.getElementById('new-chat-phone').value = '';
    document.getElementById('new-chat-result').textContent = '';
    document.getElementById('new-chat-result').className = 'phone-check-result';
    utils.hide('new-chat-profile');
    this.state.newChatJid = null;
    document.getElementById('new-chat-phone').focus();
  }

  hideNewChatPanel() {
    utils.hide('new-chat-panel');
    if (this.state.currentChatJid) {
      utils.show('chat-active-view');
    } else {
      utils.show('chat-welcome');
    }
  }

  async checkNewChatNumber() {
    const input = document.getElementById('new-chat-phone');
    const result = document.getElementById('new-chat-result');
    const checkBtn = document.getElementById('new-chat-check-btn');
    const startBtn = document.getElementById('start-chat-btn');
    const phone = input.value.trim().replace(/\D/g, '');

    if (!phone || phone.length < 10) {
      result.textContent = 'Geçerli bir numara girin (en az 10 rakam)';
      result.className = 'phone-check-result error';
      return;
    }

    result.innerHTML = '<span class="spinner"></span> Kontrol ediliyor...';
    result.className = 'phone-check-result loading';
    checkBtn.disabled = true;
    if (startBtn) startBtn.disabled = true;
    utils.hide('new-chat-profile');
    this.state.newChatJid = null;

    try {
      const response = await api.checkNumber(phone);

      if (response.success && response.data?.isOnWhatsApp) {
        result.innerHTML = '<i class="fas fa-check-circle"></i> WhatsApp\'ta kayıtlı';
        result.className = 'phone-check-result success';

        // JID'i kaydet
        this.state.newChatJid = response.data.jid || `${phone}@s.whatsapp.net`;

        // Show profile preview
        const avatar = document.getElementById('new-chat-avatar');
        const profilePhone = document.getElementById('new-chat-profile-phone');
        const profileStatus = document.getElementById('new-chat-profile-status');

        avatar.innerHTML = `<i class="fas fa-user"></i>`;
        profilePhone.textContent = utils.formatPhone(phone);
        profileStatus.textContent = 'WhatsApp Kullanıcısı';

        // Try to get profile info
        try {
          const profile = await api.getProfile(this.state.newChatJid);
          if (profile.success && profile.data) {
            profileStatus.textContent = profile.data.status || 'WhatsApp Kullanıcısı';
            if (profile.data.name) {
              profilePhone.textContent = profile.data.name;
            }
          }
        } catch (e) {
          // Profile bilgisi alınamazsa varsayılanları kullan
        }

        utils.show('new-chat-profile');
        if (startBtn) startBtn.disabled = false;

      } else {
        result.innerHTML = '<i class="fas fa-times-circle"></i> WhatsApp\'ta kayıtlı değil';
        result.className = 'phone-check-result error';
        this.state.newChatJid = null;
        if (startBtn) startBtn.disabled = true;
      }
    } catch (error) {
      result.textContent = 'Kontrol hatası: ' + error.message;
      result.className = 'phone-check-result error';
      this.state.newChatJid = null;
      if (startBtn) startBtn.disabled = true;
    } finally {
      checkBtn.disabled = false;
    }
  }

  startNewChat() {
    // Önce state'deki jid'i dene
    if (this.state.newChatJid) {
      this.openChat(this.state.newChatJid);
      return;
    }

    // Jid yoksa, direkt telefon numarasından oluştur
    const phone = document.getElementById('new-chat-phone').value.trim().replace(/\D/g, '');
    if (phone && phone.length >= 10) {
      const jid = `${phone}@s.whatsapp.net`;
      this.state.newChatJid = jid;
      this.openChat(jid);
    } else {
      utils.toast('Önce geçerli bir numara girin', 'warning');
    }
  }

  // ==================== ACTIVE CHAT ====================

  async openChat(jid, retryCount = 0) {
    // Stop any existing chat stream
    this.stopChatStream();

    this.state.currentChatJid = jid;

    // Remove from unread set
    if (this.state.unreadChats.has(jid)) {
      this.state.unreadChats.delete(jid);
      this.updateUnreadBadge();
    }

    // Hide other panels, show chat view
    utils.hide('chat-welcome');
    utils.hide('new-chat-panel');
    utils.show('chat-active-view');

    // Update active state in list
    document.querySelectorAll('.chat-item').forEach(item => {
      item.classList.toggle('active', item.dataset.jid === jid);
    });

    // Get chat info
    const chatItem = document.querySelector(`.chat-item[data-jid="${jid}"]`);
    const name = chatItem?.querySelector('.chat-item-name')?.textContent || utils.formatJid(jid);
    const initial = (name || '?').charAt(0).toUpperCase();

    document.getElementById('chat-header-name').textContent = name;
    document.getElementById('chat-header-status').textContent = 'yükleniyor...';
    document.getElementById('chat-header-avatar').textContent = initial;

    const messagesContainer = document.getElementById('chat-messages');

    // İlk yüklemede loading göster, retry'da gösterme
    if (retryCount === 0) {
      messagesContainer.innerHTML = '<div class="chats-empty"><span class="spinner"></span></div>';
    }

    try {
      const response = await api.getMessageHistory(jid, 50);

      if (response.success && response.data?.messages?.length > 0) {
        let lastDate = '';
        let html = '';
        const seenMessageIds = new Set(); // Duplicate kontrolü için

        // Reverse to show oldest first, then newest at bottom
        const messages = [...response.data.messages].reverse();

        messages.forEach(msg => {
          // Duplicate kontrolü
          if (msg.id && seenMessageIds.has(msg.id)) {
            return;
          }
          if (msg.id) seenMessageIds.add(msg.id);

          // fromMe veya isFromMe flag'ini kullan - API'den gelen değere güven
          const isOutgoing = msg.fromMe === true || msg.isFromMe === true;
          const time = utils.formatDate(msg.timestamp, 'time');
          const content = msg.content || msg.message || msg.body || '';
          const msgDate = new Date(msg.timestamp).toLocaleDateString('tr-TR');

          // Date divider
          if (msgDate !== lastDate) {
            lastDate = msgDate;
            html += `<div class="message-date-divider"><span>${this.getDateLabel(msg.timestamp)}</span></div>`;
          }

          // Mesaj tipini kontrol et - medya mesajları için özel render
          const msgType = msg.type || 'text';
          const isMedia = ['image', 'video', 'audio', 'document', 'sticker', 'ptt', 'location', 'liveLocation', 'vcard', 'contact', 'poll', 'event'].includes(msgType);
          // Text tipinde olup [IMAGE] gibi placeholder içeren mesajları da medya olarak algıla
          const mediaTagMatch = !isMedia && content.match(/^\[(?:Image|File|Video|Audio|Document|Sticker|Ptt|Media|Location|Live Location|Contact|Poll|Event|IMAGE|FILE|VIDEO|AUDIO|DOCUMENT|STICKER|PTT|MEDIA|LOCATION|CONTACT|POLL|EVENT|\d+\s*Contact)\]$/i);
          const treatAsMedia = isMedia || !!mediaTagMatch;

          // Boş text mesajlarını atla (bilinmeyen mesaj tipleri olabilir)
          if (!treatAsMedia && !content.trim()) {
            return;
          }

          if (treatAsMedia) {
            let effectiveType = msgType;
            if (mediaTagMatch) {
              const tagMap = { 'IMAGE': 'image', 'FILE': 'document', 'VIDEO': 'video', 'AUDIO': 'audio', 'DOCUMENT': 'document', 'STICKER': 'sticker', 'PTT': 'ptt', 'MEDIA': 'image', 'LOCATION': 'location', 'LIVE LOCATION': 'liveLocation', 'CONTACT': 'vcard', 'POLL': 'poll', 'EVENT': 'event' };
              effectiveType = tagMap[mediaTagMatch[1].toUpperCase()] || 'image';
            }
            const mediaLabels = {
              'image': { icon: 'fa-image', label: 'Fotoğraf' },
              'video': { icon: 'fa-video', label: 'Video' },
              'audio': { icon: 'fa-headphones', label: 'Ses Mesajı' },
              'ptt': { icon: 'fa-microphone', label: 'Sesli Mesaj' },
              'document': { icon: 'fa-file-alt', label: 'Belge' },
              'sticker': { icon: 'fa-sticky-note', label: 'Çıkartma' },
              'location': { icon: 'fa-map-marker-alt', label: 'Konum' },
              'liveLocation': { icon: 'fa-street-view', label: 'Canlı Konum' },
              'vcard': { icon: 'fa-address-card', label: 'Kişi' },
              'contact': { icon: 'fa-address-card', label: 'Kişi' },
              'poll': { icon: 'fa-poll', label: 'Anket' },
              'event': { icon: 'fa-calendar-check', label: 'Etkinlik' }
            };
            const media = mediaLabels[effectiveType] || { icon: 'fa-file', label: 'Dosya' };

            html += `
              <div class="message-bubble ${isOutgoing ? 'outgoing' : 'incoming'}" data-msg-id="${msg.id || ''}">
                <div class="media-placeholder">
                  <div class="media-placeholder-icon"><i class="fas ${media.icon}"></i></div>
                  <div class="media-placeholder-info">
                    <span class="media-placeholder-label">${media.label}</span>
                    <span class="media-placeholder-hint"><i class="fas fa-lock"></i> Daha fazla gizlilik için bu mesajı yalnızca telefonunuzdan açabilirsiniz.</span>
                  </div>
                </div>
                <div class="message-meta">
                  <span class="message-time">${time}</span>
                  ${isOutgoing ? `<span class="message-status ${msg.status === 'read' ? 'read' : ''}">
                    <i class="fas fa-check-double"></i>
                  </span>` : ''}
                </div>
              </div>
            `;
          } else {
            html += `
              <div class="message-bubble ${isOutgoing ? 'outgoing' : 'incoming'}" data-msg-id="${msg.id || ''}">
                <div class="message-text">${utils.escapeHtml(content)}</div>
                <div class="message-meta">
                  <span class="message-time">${time}</span>
                  ${isOutgoing ? `<span class="message-status ${msg.status === 'read' ? 'read' : ''}">
                    <i class="fas fa-check-double"></i>
                  </span>` : ''}
                </div>
              </div>
            `;
          }
        });

        messagesContainer.innerHTML = html;
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        document.getElementById('chat-header-status').textContent = `${response.data.messages.length} mesaj`;
      } else {
        messagesContainer.innerHTML = `
          <div class="chats-empty">
            <i class="fas fa-comments"></i>
            <p>Henüz mesaj yok</p>
          </div>
        `;
        document.getElementById('chat-header-status').textContent = 'Yeni sohbet';
      }

      // Sohbet açıldığında okundu olarak işaretle
      try {
        await api.markAsRead(jid);
      } catch (readErr) {
        console.log('Failed to mark as read:', readErr);
      }

      // Start chat-specific SSE stream
      this.startChatStream(jid);

      // Refresh chat list
      this.loadChats();

    } catch (error) {
      console.error('Load chat error:', error);

      // Rate limit hatasını özel olarak işle
      const isRateLimit = error.message && (error.message.includes('Rate limit') || error.message.includes('Çok fazla istek') || error.message.includes('Too many requests'));

      if (isRateLimit && retryCount < 3) {
        // Rate limit - otomatik retry
        const waitTime = (retryCount + 1) * 2; // 2, 4, 6 saniye bekle
        document.getElementById('chat-header-status').textContent = `${waitTime} saniye bekliyor...`;

        messagesContainer.innerHTML = `
          <div class="chats-empty">
            <span class="spinner"></span>
            <p>Çok fazla istek. ${waitTime} saniye bekleniyor...</p>
          </div>
        `;

        setTimeout(() => {
          if (this.state.currentChatJid === jid) {
            this.openChat(jid, retryCount + 1);
          }
        }, waitTime * 1000);
        return;
      }

      let errorMessage = error.message;
      if (isRateLimit) {
        errorMessage = 'Çok fazla istek gönderildi. Lütfen birkaç saniye bekleyin.';
      }

      messagesContainer.innerHTML = `
        <div class="chats-empty">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Mesajlar yüklenemedi</p>
          <small>${utils.escapeHtml(errorMessage)}</small>
          <button class="btn btn-secondary btn-sm" onclick="app.openChat('${jid}')" style="margin-top: 10px;">
            <i class="fas fa-redo"></i> Tekrar Dene
          </button>
        </div>
      `;
      document.getElementById('chat-header-status').textContent = 'Yükleme hatası';
    }

    document.getElementById('chat-message-input').focus();
  }

  getDateLabel(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Bugün';
    if (date.toDateString() === yesterday.toDateString()) return 'Dün';
    return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  }


  closeChat() {
    // Stop chat-specific SSE stream
    this.stopChatStream();

    this.state.currentChatJid = null;
    utils.hide('chat-active-view');
    utils.show('chat-welcome');

    document.querySelectorAll('.chat-item').forEach(item => {
      item.classList.remove('active');
    });
  }

  async sendChatMessage() {
    const input = document.getElementById('chat-message-input');
    const message = input.value.trim();
    const jid = this.state.currentChatJid;

    if (!message || !jid) return;

    const sendBtn = document.getElementById('chat-send-btn');
    const messagesContainer = document.getElementById('chat-messages');

    // Bağlantı durumunu önce kontrol et
    if (!this.state.isConnected) {
      // State'e güvenme, API'den kontrol et
      try {
        const statusResponse = await api.getStatus();
        if (!statusResponse.success || !statusResponse.data?.isConnected) {
          utils.toast('WhatsApp bağlı değil. Lütfen önce bağlanın.', 'warning');
          return;
        }
        // Aslında bağlıymış, state'i güncelle
        this.state.isConnected = true;
        this.updateConnectionUI();
      } catch (error) {
        utils.toast('Bağlantı kontrol edilemedi: ' + error.message, 'error');
        return;
      }
    }

    try {
      sendBtn.disabled = true;
      input.disabled = true;

      // Optimistic update
      const time = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      const tempMsg = document.createElement('div');
      tempMsg.className = 'message-bubble outgoing';
      tempMsg.innerHTML = `
        <div class="message-text">${utils.escapeHtml(message)}</div>
        <div class="message-meta">
          <span class="message-time">${time}</span>
          <span class="message-status sending"><i class="fas fa-clock"></i></span>
        </div>
      `;
      messagesContainer.appendChild(tempMsg);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;

      input.value = '';
      input.style.height = 'auto';

      // Send typing indicator if enabled
      await this.sendTypingIfEnabled(jid);

      const response = await api.sendMessage(jid, message);

      if (response.success) {
        // Update status to sent
        tempMsg.querySelector('.message-status').innerHTML = '<i class="fas fa-check"></i>';
        tempMsg.querySelector('.message-status').classList.remove('sending');
      } else {
        throw new Error(response.message || 'Mesaj gönderilemedi');
      }

    } catch (error) {
      console.error('Send message error:', error);

      // Hata durumunda mesajı hata durumuna güncelle
      const lastBubble = messagesContainer.querySelector('.message-bubble:last-child');
      if (lastBubble) {
        const statusEl = lastBubble.querySelector('.message-status');
        if (statusEl) {
          statusEl.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: #f44336;"></i>';
          statusEl.classList.remove('sending');
          statusEl.classList.add('failed');
          statusEl.title = 'Gönderim başarısız - tıklayarak tekrar deneyin';
          statusEl.style.cursor = 'pointer';

          // Retry click handler
          const failedMessage = lastBubble.querySelector('.message-text')?.textContent || '';
          statusEl.onclick = async () => {
            statusEl.innerHTML = '<i class="fas fa-clock"></i>';
            statusEl.classList.remove('failed');
            statusEl.classList.add('sending');
            statusEl.style.cursor = 'default';
            statusEl.onclick = null;

            try {
              const retryResponse = await api.sendMessage(jid, failedMessage);
              if (retryResponse.success) {
                statusEl.innerHTML = '<i class="fas fa-check"></i>';
                statusEl.classList.remove('sending');
                utils.toast('Mesaj gönderildi', 'success');
              } else {
                throw new Error(retryResponse.message || 'Tekrar gönderim başarısız');
              }
            } catch (retryError) {
              statusEl.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: #f44336;"></i>';
              statusEl.classList.remove('sending');
              statusEl.classList.add('failed');
              statusEl.style.cursor = 'pointer';
              utils.toast('Tekrar gönderim başarısız', 'error');
            }
          };
        }
      }

      // Bağlantı kopmuş olabilir - kontrol et
      try {
        const statusResponse = await api.getStatus();
        if (statusResponse.success && statusResponse.data) {
          this.state.isConnected = statusResponse.data.isConnected;
          this.state.isConnecting = statusResponse.data.isConnecting;
          this.updateConnectionUI();

          if (!statusResponse.data.isConnected) {
            utils.toast('Mesaj gönderilemedi: WhatsApp yeniden bağlanıyor...', 'warning');
          } else {
            // Bağlı ama gönderim başarısız - API retry yapıyor olabilir
            const errorMsg = error.message || '';
            if (errorMsg.includes('Maksimum deneme')) {
              utils.toast('Mesaj gönderilemedi: Bağlantı sorunları yaşanıyor', 'error');
            } else {
              utils.toast('Mesaj gönderilemedi: ' + error.message, 'error');
            }
          }
        }
      } catch {
        utils.toast('Mesaj gönderilemedi: ' + error.message, 'error');
      }
    } finally {
      sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  // ==================== MESSAGING TAB ====================

  switchMessageType(type) {
    this.state.messageType = type;

    document.querySelectorAll('.messaging-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.type === type);
    });

    utils.toggle('single-message-form', type === 'single');
    utils.toggle('bulk-message-form', type === 'bulk');
  }

  /**
   * Send typing indicator if typing duration is enabled in addon settings
   */
  async sendTypingIfEnabled(jid) {
    try {
      const getTypingDuration = () => new Promise(resolve => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.get(['typingDuration'], (result) => resolve(result.typingDuration || 0));
        } else {
          resolve(0);
        }
      });
      const duration = await getTypingDuration();
      if (duration > 0) {
        await api.sendTyping(jid, 'composing');
        await new Promise(r => setTimeout(r, duration));
        await api.sendTyping(jid, 'paused');
      }
    } catch (e) {
      // Typing indicator is non-critical, silently fail
      console.debug('Typing indicator failed:', e);
    }
  }

  setScheduleMode(mode) {
    this.state.singleScheduleMode = mode;

    document.querySelectorAll('.schedule-option[data-schedule]').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.schedule === mode);
    });

    utils.toggle('single-schedule-datetime', mode === 'later');

    // Datetime picker'a minimum tarih ayarla (1 dakika sonrası)
    if (mode === 'later') {
      const datetimeInput = document.getElementById('single-datetime');
      if (datetimeInput) {
        datetimeInput.min = utils.getMinScheduleDate();
        // Varsayılan olarak 1 saat sonrasını ayarla
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

    if (type !== 'text' && !mediaUrl) {
      utils.toast('Medya URL girin', 'warning');
      return;
    }

    if (isScheduled && !datetime) {
      utils.toast('Gönderim zamanı seçin', 'warning');
      return;
    }

    // Geçmiş zaman kontrolü
    if (isScheduled && datetime) {
      const scheduledTime = new Date(datetime);
      const now = new Date();
      const minTime = new Date(now.getTime() + 60000); // En az 1 dakika sonrası
      if (scheduledTime <= minTime) {
        utils.toast('Gönderim zamanı en az 1 dakika sonrası olmalıdır', 'warning');
        // min attribute'u güncelle
        document.getElementById('single-datetime').min = utils.getMinScheduleDate();
        return;
      }
    }

    const btn = document.getElementById('single-send-btn');

    // Bağlantı kontrolü
    if (!this.state.isConnected) {
      try {
        const statusResponse = await api.getStatus();
        if (!statusResponse.success || !statusResponse.data?.isConnected) {
          utils.toast('WhatsApp bağlı değil. Lütfen önce bağlanın.', 'warning');
          return;
        }
        // Aslında bağlıymış
        this.state.isConnected = true;
        this.updateConnectionUI();
      } catch (error) {
        utils.toast('Bağlantı kontrol edilemedi', 'error');
        return;
      }
    }

    try {
      utils.setLoading(btn, true, 'Gönderiliyor...');

      // Telefon numarasını normalleştir
      const normalizedPhone = utils.normalizePhone(recipient);
      if (!normalizedPhone || normalizedPhone.length < 10) {
        utils.toast('Geçersiz telefon numarası', 'warning');
        utils.setLoading(btn, false);
        return;
      }

      const jid = `${normalizedPhone}@s.whatsapp.net`;

      if (isScheduled) {
        // Schedule message
        const scheduledAt = new Date(datetime).toISOString();
        const response = await api.scheduleMessage(jid, message, scheduledAt, type, { mediaUrl, caption });

        if (response.success) {
          utils.toast('Mesaj zamanlandı!', 'success');
          document.getElementById('single-recipient').value = '';
          document.getElementById('single-message').value = '';
          document.getElementById('single-datetime').value = '';
          const sc1 = document.getElementById('single-char-count'); if (sc1) sc1.textContent = '0';
          this.setScheduleMode('now');
          this.loadScheduledMessages();
        } else {
          throw new Error(response.message || 'Mesaj zamanlanamadı');
        }
      } else {
        // Send immediately - typing indicator
        await this.sendTypingIfEnabled(jid);
        const response = await api.sendMessage(jid, message, type, { mediaUrl, caption });

        if (response.success) {
          utils.toast('Mesaj gönderildi!', 'success');
          document.getElementById('single-recipient').value = '';
          document.getElementById('single-message').value = '';
          const sc2 = document.getElementById('single-char-count'); if (sc2) sc2.textContent = '0';
        } else {
          throw new Error(response.message || 'Mesaj gönderilemedi');
        }
      }
    } catch (error) {
      const errorMsg = error.data?.error || error.data?.message || error.message || 'İşlem başarısız';
      utils.toast(errorMsg, 'error');
    } finally {
      utils.setLoading(btn, false);
    }
  }

  // ==================== BULK MESSAGES ====================

  setBulkMessageType(type) {
    // Update hidden input
    document.getElementById('bulk-type').value = type;

    // Update button states
    document.querySelectorAll('.type-option[data-bulk-type]').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.bulkType === type);
    });

    // Toggle media/text sections
    utils.toggle('bulk-text-group', type === 'text');
    utils.toggle('bulk-media-group', type !== 'text');
  }

  toggleBulkMediaInput(type) {
    utils.toggle('bulk-text-group', type === 'text');
    utils.toggle('bulk-media-group', type !== 'text');
  }

  updateRecipientCount(text) {
    // Boş olmayan satır sayısını hesapla
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
    const useTimeWindow = document.getElementById('bulk-time-window').checked;
    const useSchedule = document.getElementById('bulk-schedule-enabled')?.checked;
    const scheduleDateTime = document.getElementById('bulk-start-datetime')?.value;

    const recipients = utils.parseRecipients(recipientsText);

    if (recipients.length === 0) {
      utils.toast('Geçerli alıcı numarası girin', 'warning');
      return;
    }

    if (type === 'text' && !message) {
      utils.toast('Mesaj girin', 'warning');
      return;
    }

    if (type !== 'text' && !mediaUrl) {
      utils.toast('Medya URL girin', 'warning');
      return;
    }

    // Geçmiş zaman kontrolü (ileri tarih zamanlaması)
    if (useSchedule && scheduleDateTime) {
      const scheduledTime = new Date(scheduleDateTime);
      const now = new Date();
      const minTime = new Date(now.getTime() + 60000);
      if (scheduledTime <= minTime) {
        utils.toast('Başlangıç zamanı en az 1 dakika sonrası olmalıdır', 'warning');
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

    // Bağlantı kontrolü
    if (!this.state.isConnected) {
      try {
        const statusResponse = await api.getStatus();
        if (!statusResponse.success || !statusResponse.data?.isConnected) {
          utils.toast('WhatsApp bağlı değil. Lütfen önce bağlanın.', 'warning');
          return;
        }
        // Aslında bağlıymış
        this.state.isConnected = true;
        this.updateConnectionUI();
      } catch (error) {
        utils.toast('Bağlantı kontrol edilemedi', 'error');
        return;
      }
    }

    try {
      utils.setLoading(btn, true, 'Başlatılıyor...');

      const options = { minDelay, maxDelay, mediaUrl, caption };

      if (useTimeWindow) {
        options.timeWindow = {
          startTime: document.getElementById('bulk-start-time').value,
          endTime: document.getElementById('bulk-end-time').value
        };
      }

      // İleri tarih zamanlaması
      if (useSchedule && scheduleDateTime) {
        options.scheduledAt = new Date(scheduleDateTime).toISOString();
      }

      const response = await api.createBulkJob(recipients, message, type, options);

      if (response.success) {
        const successMsg = useSchedule ?
          `Toplu gönderim zamanlandı (${recipients.length} alıcı)` :
          `Toplu gönderim başlatıldı (${recipients.length} alıcı)`;
        utils.toast(successMsg, 'success');
        document.getElementById('bulk-recipients').value = '';
        document.getElementById('bulk-message').value = '';
        document.getElementById('recipient-count').textContent = '0';
        document.getElementById('bulk-char-count').textContent = '0';
        // Reset schedule toggle buttons
        const scheduleCheckbox = document.getElementById('bulk-schedule-enabled');
        if (scheduleCheckbox) {
          scheduleCheckbox.checked = false;
          utils.hide('bulk-schedule-datetime');
        }
        document.querySelectorAll('.schedule-option[data-bulk-schedule]').forEach(o => o.classList.remove('active'));
        document.querySelector('.schedule-option[data-bulk-schedule="now"]')?.classList.add('active');
        // Reset time window toggle buttons
        const twCheckbox = document.getElementById('bulk-time-window');
        if (twCheckbox) {
          twCheckbox.checked = false;
          utils.hide('time-window-group');
        }
        document.querySelectorAll('.schedule-option[data-time-window]').forEach(o => o.classList.remove('active'));
        document.querySelector('.schedule-option[data-time-window="off"]')?.classList.add('active');
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

        // Add event listeners
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

    // Status labels in Turkish
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
          ${job.timeWindow ? `<div class="job-detail-row"><span><i class="fas fa-clock"></i> Zaman: ${job.timeWindow.startTime} - ${job.timeWindow.endTime}</span></div>` : ''}
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
          return; // Don't reload jobs list
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
      // API returns 'recipients' not 'items'
      const recipients = job.recipients || [];

      // Group recipients by status
      // API status values: 'pending', 'processing', 'completed', 'failed'
      const sent = recipients.filter(i => i.status === 'completed' || i.status === 'sent');
      const failed = recipients.filter(i => i.status === 'failed');
      const pending = recipients.filter(i => i.status === 'pending' || i.status === 'processing' || i.status === 'queued');

      // İşin durumuna göre varsayılan sekmeyi belirle
      let defaultTab = 'pending';
      let defaultList = pending;
      if (pending.length === 0 && sent.length > 0) {
        defaultTab = 'sent';
        defaultList = sent;
      } else if (pending.length === 0 && sent.length === 0 && failed.length > 0) {
        defaultTab = 'failed';
        defaultList = failed;
      }

      // Status label
      const statusLabels = {
        'queued': 'Kuyrukta',
        'processing': 'İşleniyor',
        'paused': 'Duraklatıldı',
        'completed': 'Tamamlandı',
        'failed': 'Başarısız',
        'cancelled': 'İptal Edildi'
      };
      const statusLabel = statusLabels[job.status] || job.status;

      // Mesaj içeriği
      const messageContent = job.message || job.caption || (job.mediaUrl ? `[${job.messageType?.toUpperCase() || 'MEDYA'}]` : '[Boş]');

      // Create modal content
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

      // Insert modal
      document.body.insertAdjacentHTML('beforeend', modalHtml);

      // Store data for tab switching
      const tabData = { sent, failed, pending };

      // Event listeners
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

      // Close on backdrop click
      document.getElementById('job-details-modal').addEventListener('click', (e) => {
        if (e.target.id === 'job-details-modal') {
          e.target.remove();
        }
      });

      // ESC tuşu ile kapatma
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
      // Use phone field directly if available, otherwise extract from jid
      const phone = item.phone || utils.formatJid(item.jid);
      const formattedPhone = utils.formatPhone(phone) || phone;
      // API returns processedAt, not sentAt
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

  // ==================== SCHEDULED MESSAGES ====================

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

    // Status label in Turkish
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

  // ==================== AUTO REFRESH ====================

  startAutoRefresh() {
    // Bağlantı durumu kontrolü - her 15 saniyede bir
    setInterval(() => {
      this.checkConnectionHealth();
    }, 15000);

    // Tab verilerini yenileme - her 30 saniyede bir
    setInterval(() => {
      if (this.state.isConnected) {
        switch (this.state.currentTab) {
          case 'dashboard':
            this.loadStats();
            break;
          case 'messaging':
            this.loadBulkJobs();
            break;
          // Note: chats are updated via SSE now
        }
      }
    }, 30000);
  }

  /**
   * Check connection health and sync SSE status
   */
  async checkConnectionHealth() {
    // Debounce kontrolü - çok sık çağrılmasını önle
    if (this._healthCheckInProgress) return;
    this._healthCheckInProgress = true;

    try {
      // Bağlı görünüyorsa ama SSE aktif değilse, yeniden başlat
      if (this.state.isConnected && !api.isMessageStreamActive()) {
        console.log('SSE stream inactive but state says connected, restarting immediately...');
        this.startGlobalMessageStream();
        // Aynı zamanda API'den doğrula
        const response = await api.getStatus();
        if (response.success && response.data) {
          if (!response.data.isConnected) {
            // Bağlantı kopmuş
            console.log('Connection lost detected in health check');
            this.state.isConnected = false;
            this.state.isConnecting = response.data.isConnecting || false;
            this.state.sessionInfo = null;

            if (!response.data.isConnecting) {
              this.resetConnectButton();
            }

            this.updateConnectionUI();
            this.stopGlobalMessageStream();
            utils.toast('WhatsApp bağlantısı kesildi', 'warning');
          }
        }
        return;
      }

      // Bağlı görünüyor ve SSE aktif - periyodik doğrulama yap
      if (this.state.isConnected) {
        const response = await api.getStatus();
        if (response.success && response.data) {
          if (!response.data.isConnected && this.state.isConnected) {
            // Bağlantı kopmuş ama UI hala bağlı gösteriyor
            console.log('Connection lost detected in health check');
            this.state.isConnected = false;
            this.state.isConnecting = response.data.isConnecting || false;
            this.state.sessionInfo = null;

            if (!response.data.isConnecting) {
              this.resetConnectButton();
            }

            this.updateConnectionUI();
            this.stopGlobalMessageStream();
            utils.toast('WhatsApp bağlantısı kesildi', 'warning');
          } else if (response.data.isConnected && !this.state.isConnected) {
            // Bağlı ama state yanlış - düzelt
            console.log('State out of sync, fixing...');
            this.state.isConnected = true;
            this.state.isConnecting = false;
            this.state.sessionInfo = response.data.session;
            this.updateConnectionUI();

            if (!api.isMessageStreamActive()) {
              this.startGlobalMessageStream();
            }
          }
        }
      }

      // Bağlı değil görünüyor ama aslında bağlı olabilir
      if (!this.state.isConnected && !this.state.isConnecting) {
        try {
          const response = await api.getStatus();
          if (response.success && response.data?.isConnected) {
            // Aslında bağlı!
            console.log('Actually connected, fixing state...');
            this.state.isConnected = true;
            this.state.sessionInfo = response.data.session;
            this.updateConnectionUI();
            this.startGlobalMessageStream();
          }
        } catch {
          // API erişilemedi, skip
        }
      }
    } catch (error) {
      console.error('Health check failed:', error);
    } finally {
      this._healthCheckInProgress = false;
    }
  }

  // ==================== SSE MESSAGE STREAMS ====================

  /**
   * Start global message stream for unread notifications
   * Called when connected to WhatsApp
   */
  startGlobalMessageStream() {
    console.log('Starting global message stream...');

    // Önceki stream varsa kapat
    this.stopGlobalMessageStream();

    // Bağlantı durumunu kaydet
    let streamReconnectAttempts = 0;
    const maxStreamReconnectAttempts = 5;

    api.startMessageStream(
      // onMessage
      (message) => {
        console.log('New message received:', message);

        // JID normalize karşılaştırma
        const msgFrom = (message.from || '').split('@')[0].split(':')[0];
        const currentChat = (this.state.currentChatJid || '').split('@')[0].split(':')[0];

        // Only consider chat "open" if we're on chats tab AND viewing that specific chat
        const isChatOpen = this.state.currentTab === 'chats' && currentChat && msgFrom === currentChat;

        if (!isChatOpen) {
          this.state.unreadChats.add(message.from);
          this.updateUnreadBadge();

          // Refresh chat list if on chats tab
          if (this.state.currentTab === 'chats') {
            this.loadChats();
          }
        } else {
          // Message is for current chat, add to view
          this.appendMessageToChat(message);
        }
      },
      // onInit
      (data) => {
        console.log('SSE init:', data);
        if (data.isConnected !== undefined) {
          const wasConnected = this.state.isConnected;

          // SSE'den gelen durumu doğrudan UI'ya yansıtmadan önce kontrol et
          if (!data.isConnected && wasConnected) {
            // SSE bağlantı kesildi diyor ama gerçekten öyle mi?
            // API'den doğrula
            api.getStatus().then(response => {
              if (response.success && response.data) {
                if (response.data.isConnected) {
                  // Aslında hala bağlı - SSE'yi yeniden başlat
                  console.log('SSE said disconnected but API says connected, restarting stream...');
                  if (streamReconnectAttempts < maxStreamReconnectAttempts) {
                    streamReconnectAttempts++;
                    setTimeout(() => this.startGlobalMessageStream(), 2000);
                  }
                } else {
                  // Gerçekten bağlantı kopmuş
                  this.state.isConnected = false;
                  this.state.isConnecting = response.data.isConnecting || false;
                  this.resetConnectButton();
                  this.updateConnectionUI();
                  this.stopGlobalMessageStream();
                  utils.toast('WhatsApp bağlantısı kesildi', 'warning');
                }
              }
            }).catch(() => {
              // API erişilemedi - muhtemelen gerçekten kopmuş
              this.state.isConnected = false;
              this.state.isConnecting = false;
              this.resetConnectButton();
              this.updateConnectionUI();
              this.stopGlobalMessageStream();
            });
          } else if (data.isConnected) {
            // Bağlı durumu onaylandı
            this.state.isConnected = true;
            this.state.isConnecting = false;
            streamReconnectAttempts = 0; // Reset counter on success
            this.updateConnectionUI();
          }
        }
      },
      // onError
      (error) => {
        console.error('Global SSE error:', error);
        // SSE hatası - handleSSEError çağrılacak
        this.handleSSEError();
      }
    );
  }

  /**
   * Stop global message stream
   */
  stopGlobalMessageStream() {
    console.log('Stopping global message stream...');
    api.stopMessageStream();
  }

  /**
   * Handle SSE connection error
   * Checks actual connection status from API before making decisions
   */
  async handleSSEError() {
    console.log('Handling SSE error, checking connection status...');

    // Debounce - çok sık çağrılmasını önle
    if (this._sseErrorHandling) {
      console.log('SSE error handling already in progress');
      return;
    }
    this._sseErrorHandling = true;

    try {
      const response = await api.getStatus();

      if (response.success && response.data) {
        const wasConnected = this.state.isConnected;
        const isNowConnected = response.data.isConnected;
        const isNowConnecting = response.data.isConnecting || false;

        this.state.isConnected = isNowConnected;
        this.state.isConnecting = isNowConnecting;
        this.state.sessionInfo = response.data.session;

        // Connect butonunu güncelle
        if (!isNowConnected && !isNowConnecting) {
          this.resetConnectButton();
        }

        this.updateConnectionUI();

        // Bağlantı kesilmiş ve önceden bağlıydıysa bildir
        if (wasConnected && !isNowConnected && !isNowConnecting) {
          utils.toast('WhatsApp bağlantısı kesildi', 'warning');
        }

        // Hala bağlıysa SSE stream'i yeniden başlat
        if (isNowConnected) {
          console.log('Still connected, restarting SSE stream in 3s...');
          setTimeout(() => {
            if (this.state.isConnected) {
              this.startGlobalMessageStream();
            }
          }, 3000);
        }
      }
    } catch (error) {
      console.error('Status check failed:', error);
      // API erişilemez durumda - 10 saniye sonra tekrar dene
      setTimeout(async () => {
        try {
          const retryResponse = await api.getStatus();
          if (retryResponse.success && retryResponse.data) {
            this.state.isConnected = retryResponse.data.isConnected;
            this.state.isConnecting = retryResponse.data.isConnecting || false;

            if (retryResponse.data.isConnected) {
              this.updateConnectionUI();
              this.startGlobalMessageStream();
            } else {
              this.resetConnectButton();
              this.updateConnectionUI();
            }
          }
        } catch {
          // Hala erişilemez
          this.state.isConnected = false;
          this.state.isConnecting = false;
          this.resetConnectButton();
          this.updateConnectionUI();
        }
      }, 10000);
    } finally {
      // Debounce süresi
      setTimeout(() => {
        this._sseErrorHandling = false;
      }, 5000);
    }
  }

  /**
   * Start chat-specific SSE stream when opening a chat
   */
  startChatStream(jid) {
    console.log('Starting chat stream for:', jid);

    api.startChatStream(
      jid,
      // onMessage
      (message) => {
        console.log('Chat message received:', message);
        this.appendMessageToChat(message);

        // Mark this chat as read since we're viewing it
        if (this.state.unreadChats.has(jid)) {
          this.state.unreadChats.delete(jid);
          this.updateUnreadBadge();
        }
      },
      // onInit
      (data) => {
        console.log('Chat SSE init:', data);
      },
      // onError
      (error) => {
        console.error('Chat SSE error:', error);
      }
    );
  }

  /**
   * Stop chat-specific SSE stream
   */
  stopChatStream() {
    console.log('Stopping chat stream...');
    api.stopChatStream();
  }

  /**
   * Append a new message to the chat view
   */
  appendMessageToChat(message) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;

    // Check if this is the current chat
    const messageJid = message.from || message.jid;
    const isOutgoing = message.fromMe === true || message.isFromMe === true;

    // JID normalize karşılaştırması - numara kısmını çıkararak karşılaştır
    const normalizeJid = (jid) => jid ? jid.split('@')[0].split(':')[0] : '';
    const messageNumber = normalizeJid(messageJid);
    const currentNumber = normalizeJid(this.state.currentChatJid);

    // Gelen mesajlar için JID kontrolü, gönderilen mesajlar için her zaman ekle
    if (!isOutgoing && messageNumber !== currentNumber) return;

    // Duplicate kontrolü - message ID ile
    const messageId = message.id || message.messageId;
    if (messageId) {
      const existingMsg = messagesContainer.querySelector(`[data-msg-id="${messageId}"]`);
      if (existingMsg) {
        console.log('Duplicate message ignored (ID match):', messageId);
        return;
      }
    }

    // İçerik ve zaman bazlı duplicate kontrolü
    const content = message.content || message.message || message.body || '';
    const timestamp = message.timestamp ? new Date(message.timestamp).getTime() : Date.now();
    const time = new Date(timestamp).toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit'
    });

    // Son 10 mesajda aynı içerik + aynı yön + 5 saniye içinde = duplicate
    const recentMessages = messagesContainer.querySelectorAll('.message-bubble');
    const recentArray = Array.from(recentMessages).slice(-10);
    for (const recent of recentArray) {
      const recentText = recent.querySelector('.message-text')?.textContent || '';
      const recentIsOutgoing = recent.classList.contains('outgoing');
      const recentTimestamp = parseInt(recent.dataset.timestamp || '0');

      if (recentText === content &&
          recentIsOutgoing === isOutgoing &&
          Math.abs(timestamp - recentTimestamp) < 5000) {
        console.log('Duplicate message ignored (content+time match)');
        return;
      }
    }

    // Remove empty state if exists
    const emptyState = messagesContainer.querySelector('.chats-empty');
    if (emptyState) emptyState.remove();

    const msgDiv = document.createElement('div');
    msgDiv.className = `message-bubble ${isOutgoing ? 'outgoing' : 'incoming'}`;
    if (messageId) msgDiv.setAttribute('data-msg-id', messageId);
    msgDiv.setAttribute('data-timestamp', String(timestamp));

    // Medya tipi kontrolü
    const msgType = message.type || 'text';
    let isMedia = ['image', 'video', 'audio', 'document', 'sticker', 'ptt', 'location', 'liveLocation', 'vcard', 'contact', 'poll', 'event'].includes(msgType);

    // Text tipinde olup [IMAGE] gibi placeholder içeren mesajları da medya olarak algıla
    let effectiveMediaType = msgType;
    if (!isMedia && content) {
      const mediaTagMatch = content.match(/^\[(?:Image|File|Video|Audio|Document|Sticker|Ptt|Media|Location|Live Location|Contact|Poll|Event|\d+\s*Contact)\]$/i);
      if (mediaTagMatch) {
        isMedia = true;
        const tagMap = { 'IMAGE': 'image', 'FILE': 'document', 'VIDEO': 'video', 'AUDIO': 'audio', 'DOCUMENT': 'document', 'STICKER': 'sticker', 'PTT': 'ptt', 'MEDIA': 'image', 'LOCATION': 'location', 'LIVE LOCATION': 'liveLocation', 'CONTACT': 'vcard', 'POLL': 'poll', 'EVENT': 'event' };
        effectiveMediaType = tagMap[mediaTagMatch[1].toUpperCase()] || 'image';
      }
    }

    // Boş text mesajlarını atla
    if (!isMedia && !content.trim()) {
      return;
    }

    if (isMedia) {
      const mediaLabels = {
        'image': { icon: 'fa-image', label: 'Fotoğraf' },
        'video': { icon: 'fa-video', label: 'Video' },
        'audio': { icon: 'fa-headphones', label: 'Ses Mesajı' },
        'ptt': { icon: 'fa-microphone', label: 'Sesli Mesaj' },
        'document': { icon: 'fa-file-alt', label: 'Belge' },
        'sticker': { icon: 'fa-sticky-note', label: 'Çıkartma' },
        'location': { icon: 'fa-map-marker-alt', label: 'Konum' },
        'liveLocation': { icon: 'fa-street-view', label: 'Canlı Konum' },
        'vcard': { icon: 'fa-address-card', label: 'Kişi' },
        'contact': { icon: 'fa-address-card', label: 'Kişi' },
        'poll': { icon: 'fa-poll', label: 'Anket' },
        'event': { icon: 'fa-calendar-check', label: 'Etkinlik' }
      };
      const media = mediaLabels[effectiveMediaType] || mediaLabels[msgType] || { icon: 'fa-file', label: 'Dosya' };

      msgDiv.innerHTML = `
        <div class="media-placeholder">
          <div class="media-placeholder-icon"><i class="fas ${media.icon}"></i></div>
          <div class="media-placeholder-info">
            <span class="media-placeholder-label">${media.label}</span>
            <span class="media-placeholder-hint"><i class="fas fa-lock"></i> Daha fazla gizlilik için bu mesajı yalnızca telefonunuzdan açabilirsiniz.</span>
          </div>
        </div>
        <div class="message-meta">
          <span class="message-time">${time}</span>
          ${isOutgoing ? `<span class="message-status"><i class="fas fa-check"></i></span>` : ''}
        </div>
      `;
    } else {
      msgDiv.innerHTML = `
        <div class="message-text">${utils.escapeHtml(content)}</div>
        <div class="message-meta">
          <span class="message-time">${time}</span>
          ${isOutgoing ? `<span class="message-status"><i class="fas fa-check"></i></span>` : ''}
        </div>
      `;
    }

    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Gelen mesaj ise ve sohbet açıksa, okundu olarak işaretle
    if (!isOutgoing && this.state.currentChatJid) {
      api.markAsRead(this.state.currentChatJid).catch(err => {
        console.log('Failed to mark as read:', err);
      });
    }
  }

  /**
   * Update unread badge in sidebar
   */
  updateUnreadBadge() {
    const count = this.state.unreadChats.size;
    const badge = document.getElementById('nav-unread-badge');
    const filterBadge = document.getElementById('unread-count');

    if (count > 0) {
      if (badge) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
      }
      if (filterBadge) {
        filterBadge.textContent = count;
        filterBadge.classList.remove('hidden');
      }
    } else {
      if (badge) badge.classList.add('hidden');
      if (filterBadge) filterBadge.classList.add('hidden');
    }
  }
}

// Initialize
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new WhatsAppBOTApp();
  app.init();
});
