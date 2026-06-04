class WhatsAppAPI {
  static CONFIG = {
    DEFAULT_TIMEOUT: 30000,
    SSE_RETRY_DELAY: 2000,
    SSE_MAX_RETRIES: 10,
    HEARTBEAT_CHECK_INTERVAL: 30000,
    HEARTBEAT_TIMEOUT: 60000,
    STATUS_CACHE_TTL: 5000,
  };

  constructor() {
    this.baseUrl = '';
    this.apiKey = '';
    this.eventSource = null;
    this.terminalEventSource = null;

    this.lastKnownState = {
      isConnected: false,
      isConnecting: false,
      lastStatusCheck: null,
      pendingStatusCheck: false,
      cachedStatus: null,
    };

    this._pendingRequests = new Map();
  }

  async init() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['apiUrl', 'apiKey'], (result) => {
        // Sunucu yapılandırılmadıysa baseUrl BOŞ kalır; varsayılan localhost'a
        // düşmeyiz, böylece kullanıcı sunucu eklemeden hiçbir istek atılmaz.
        this.baseUrl = result.apiUrl ? result.apiUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '') : '';
        this.apiKey = result.apiKey || '';
        resolve();
      });
    });
  }

  async saveSettings(url, key) {
    const normalizedUrl = url.replace(/\/api\/?$/, '').replace(/\/+$/, '');
    return new Promise((resolve) => {
      chrome.storage.local.set({ apiUrl: normalizedUrl, apiKey: key }, () => {
        this.baseUrl = normalizedUrl;
        this.apiKey = key;
        resolve();
      });
    });
  }

  // Verilen url+key ile (kayıtlı baseUrl'den BAĞIMSIZ) sunucuyu test eder.
  async testServer(url, key) {
    const base = (url || '').replace(/\/api\/?$/, '').replace(/\/+$/, '');
    if (!base) return false;
    try {
      const res = await fetch(`${base}/api/auth/status`, {
        headers: key ? { 'X-API-Key': key } : {},
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['apiUrl', 'apiKey'], (result) => {
        resolve({
          apiUrl: result.apiUrl ? result.apiUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '') : '',
          apiKey: result.apiKey || ''
        });
      });
    });
  }

  async request(endpoint, options = {}) {
    // Sunucu yapılandırılmadıysa hiç istek atma (gereksiz /auth/status vb. önlenir).
    if (!this.baseUrl) {
      throw new Error('Sunucu yapılandırılmadı. Lütfen önce bir sunucu ekleyin.');
    }

    const url = `${this.baseUrl}/api${endpoint}`;
    const timeout = options.timeout || WhatsAppAPI.CONFIG.DEFAULT_TIMEOUT;
    const cacheKey = options.method === 'GET' ? `${options.method || 'GET'}:${url}` : null;

    if (cacheKey && this._pendingRequests.has(cacheKey)) {
      return this._pendingRequests.get(cacheKey);
    }

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const requestPromise = (async () => {
      try {
        const response = await fetch(url, {
          ...options,
          headers,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        const data = await response.json();

        if (!response.ok) {
          const error = new Error(data.message || data.error || `HTTP ${response.status}`);
          error.status = response.status;
          error.data = data;
          throw error;
        }

        return data;
      } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
          throw new Error('İstek zaman aşımına uğradı. Lütfen tekrar deneyin.');
        }

        if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
          throw new Error('API bağlantısı kurulamadı. URL ve ağ ayarlarınızı kontrol edin.');
        }
        throw error;
      } finally {
        if (cacheKey) {
          this._pendingRequests.delete(cacheKey);
        }
      }
    })();

    if (cacheKey) {
      this._pendingRequests.set(cacheKey, requestPromise);
    }

    return requestPromise;
  }

  async getStatus() {
    return this.request('/auth/status');
  }

  async getQR() {
    return this.request('/auth/qr');
  }

  async requestPairingCode(phoneNumber) {
    return this.request('/auth/pairing-code', {
      method: 'POST',
      body: JSON.stringify({ phoneNumber })
    });
  }

  async logout() {
    return this.request('/auth/logout', { method: 'POST' });
  }

  async cancelConnection() {
    return this.request('/auth/cancel', { method: 'POST' });
  }

  async reconnect() {
    return this.request('/auth/reconnect', { method: 'POST' });
  }

  startQRStream(onQR, onConnected, onError, onDisconnected, onTimeout, onReconnecting) {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (!this.baseUrl) {
      if (onError) onError(new Error('Sunucu yapılandırılmadı. Lütfen önce bir sunucu ekleyin.'));
      return;
    }

    let url = `${this.baseUrl}/api/auth/qr/stream`;
    if (this.apiKey) {
      url += `?api_key=${encodeURIComponent(this.apiKey)}`;
    }

    try {
      this.eventSource = new EventSource(url);
    } catch (e) {
      console.error('Failed to create EventSource:', e);
      if (onError) onError(new Error('Sunucuya bağlanılamadı. URL ve ağ ayarlarınızı kontrol edin.'));
      return;
    }

    let isConnected = false;
    let connectionStabilized = false;
    let stabilizationTimer = null;
    let hasReceivedMessage = false;
    let stabilizationRetryCount = 0;
    const maxStabilizationRetries = 5;
    let qrPhaseRetryCount = 0;
    const maxQrPhaseRetries = 5;

    const clearStabilizationTimer = () => {
      if (stabilizationTimer) {
        clearTimeout(stabilizationTimer);
        stabilizationTimer = null;
      }
    };

    this.eventSource.onopen = () => {
      console.log('QR SSE stream opened');
      qrPhaseRetryCount = 0;
    };

    this.eventSource.onmessage = (event) => {
      hasReceivedMessage = true;
      stabilizationRetryCount = 0;

      try {
        const data = JSON.parse(event.data);

        if (data.type === 'waiting') {
          console.log('QR stream: waiting for QR code...');
        } else if (data.type === 'error') {
          console.error('QR stream server error:', data.message);
          if (onError) onError(new Error(data.message));
          this.stopQRStream();
        } else if (data.type === 'qr' && data.qrCode) {
          isConnected = false;
          connectionStabilized = false;
          clearStabilizationTimer();
          onQR(data.qrCode);
        } else if (data.type === 'connected') {
          isConnected = true;
          this.lastKnownState.isConnected = true;
          this.lastKnownState.isConnecting = false;

          onConnected(data.session);

          stabilizationTimer = setTimeout(() => {
            connectionStabilized = true;
            console.log('Connection stabilized');
          }, 5000);
        } else if (data.type === 'disconnected') {
          clearStabilizationTimer();
          if (connectionStabilized) {
            isConnected = false;
            this.lastKnownState.isConnected = false;
            if (onDisconnected) onDisconnected(data.reason);
          }
        } else if (data.type === 'timeout') {
          clearStabilizationTimer();
          if (onTimeout) onTimeout();
          this.stopQRStream();
        } else if (data.type === 'reconnecting') {
          clearStabilizationTimer();
          connectionStabilized = false;
          if (onReconnecting) onReconnecting(data);
        }
      } catch (e) {
        console.error('SSE parse error:', e);
      }
    };

    this.eventSource.onerror = (error) => {
      console.error('QR SSE error:', error);
      clearStabilizationTimer();

      if (!hasReceivedMessage) {
        console.error('QR stream failed: server unreachable (no messages received)');
        this.stopQRStream();
        if (onError) onError(new Error('Sunucuya bağlanılamadı. Sunucunun çalıştığından emin olun.'));
        return;
      }

      if (isConnected && connectionStabilized) {
        console.log('QR stream closed after successful stable connection');
        this.stopQRStream();
        return;
      }

      if (isConnected && !connectionStabilized) {
        stabilizationRetryCount++;
        if (stabilizationRetryCount <= maxStabilizationRetries) {
          console.log(`QR stream error during stabilization (${stabilizationRetryCount}/${maxStabilizationRetries}), waiting for server reconnect...`);
          return;
        }
        console.warn('Max stabilization retries reached, verifying final status...');
        this.stopQRStream();
        this.verifyConnectionStatus(true).then(status => {
          if (status.isConnected) {
            this.lastKnownState.isConnected = true;
            onConnected(status.session);
          } else {
            if (onError) onError(new Error('Bağlantı stabilize edilemedi'));
          }
        }).catch(() => {
          if (onError) onError(new Error('Bağlantı stabilize edilemedi'));
        });
        return;
      }

      if (!isConnected) {
        qrPhaseRetryCount++;
        if (qrPhaseRetryCount <= maxQrPhaseRetries) {
          console.log(`QR stream error during QR wait phase (${qrPhaseRetryCount}/${maxQrPhaseRetries}), allowing auto-retry...`);
          return;
        }
        console.warn('Max QR phase retries reached, closing stream');
      }

      if (this.eventSource && this.eventSource.readyState === EventSource.CLOSED) {
        this.verifyConnectionStatus(true).then(status => {
          if (status.isConnected) {
            console.log('SSE closed but API says connected');
            this.lastKnownState.isConnected = true;
            onConnected(status.session);
          } else if (status.isConnecting) {
            console.log('SSE closed but connection in progress');
          } else {
            if (onDisconnected) onDisconnected('SSE connection closed');
          }
        }).catch(() => {
          if (onError) onError(new Error('Sunucu bağlantısı kesildi'));
        });
      }
      this.stopQRStream();
    };
  }

  async verifyConnectionStatus(forceRefresh = false) {
    const now = Date.now();

    if (!forceRefresh &&
        this.lastKnownState.cachedStatus &&
        this.lastKnownState.lastStatusCheck &&
        (now - this.lastKnownState.lastStatusCheck) < WhatsAppAPI.CONFIG.STATUS_CACHE_TTL) {
      return this.lastKnownState.cachedStatus;
    }

    try {
      const response = await this.getStatus();
      if (response.success && response.data) {
        this.lastKnownState.isConnected = response.data.isConnected;
        this.lastKnownState.isConnecting = response.data.isConnecting || false;
        this.lastKnownState.lastStatusCheck = now;
        this.lastKnownState.cachedStatus = response.data;
        return response.data;
      }
      return { isConnected: false, isConnecting: false };
    } catch (error) {
      console.error('Status verification failed:', error);
      throw error;
    }
  }

  isQRStreamActive() {
    return this.eventSource !== null && this.eventSource.readyState === EventSource.OPEN;
  }

  stopQRStream() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  async sendMessage(jid, message, type = 'text', mediaOptions = {}) {
    const payload = {
      jid,
      type
    };

    if (type === 'text') {
      payload.message = message;
    } else {
      payload.mediaUrl = mediaOptions.mediaUrl;
      payload.mediaBase64 = mediaOptions.mediaBase64;
      payload.caption = mediaOptions.caption;
      payload.fileName = mediaOptions.fileName;
      payload.mimetype = mediaOptions.mimetype;
    }

    return this.request('/messages/send', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async sendTyping(jid, type = 'composing') {
    return this.request(`/messages/typing/${encodeURIComponent(jid)}`, {
      method: 'POST',
      body: JSON.stringify({ type })
    });
  }

  async scheduleMessage(jid, message, scheduledAt, type = 'text', mediaOptions = {}) {
    const payload = {
      jid,
      type,
      scheduledAt
    };

    if (type === 'text') {
      payload.message = message;
    } else {
      payload.mediaUrl = mediaOptions.mediaUrl;
      payload.mediaBase64 = mediaOptions.mediaBase64;
      payload.caption = mediaOptions.caption;
      payload.fileName = mediaOptions.fileName;
      payload.mimetype = mediaOptions.mimetype;
    }

    return this.request('/messages/schedule', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async getScheduledMessages() {
    return this.request('/messages/scheduled');
  }

  async getScheduledMessage(id) {
    return this.request(`/messages/scheduled/${id}`);
  }

  async updateScheduledMessage(id, updates) {
    return this.request(`/messages/scheduled/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  }

  async cancelScheduledMessage(id) {
    return this.request(`/messages/scheduled/${id}/cancel`, {
      method: 'POST'
    });
  }

  async deleteScheduledMessage(id) {
    return this.request(`/messages/scheduled/${id}`, {
      method: 'DELETE'
    });
  }

  async clearCompletedScheduled() {
    return this.request('/messages/scheduled/completed', {
      method: 'DELETE'
    });
  }

  async createBulkJob(recipients, message, type = 'text', options = {}) {
    const payload = {
      recipients,
      type,
      minDelay: options.minDelay || 3000,
      maxDelay: options.maxDelay || 10000
    };

    if (type === 'text') {
      payload.message = message;
    } else {
      payload.mediaUrl = options.mediaUrl;
      payload.mediaBase64 = options.mediaBase64;
      payload.caption = options.caption;
      payload.fileName = options.fileName;
      payload.mimetype = options.mimetype;
    }

    if (options.scheduledAt) {
      payload.scheduledAt = options.scheduledAt;
    }

    return this.request('/bulk/send', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async getBulkJobs() {
    return this.request('/bulk/jobs');
  }

  async getBulkJobStatus(jobId) {
    return this.request(`/bulk/status/${jobId}`);
  }

  async getBulkJobDetailedStatus(jobId) {
    return this.request(`/bulk/status/${jobId}/detailed`);
  }

  async pauseBulkJob(jobId) {
    return this.request(`/bulk/pause/${jobId}`, { method: 'POST' });
  }

  async resumeBulkJob(jobId) {
    return this.request(`/bulk/resume/${jobId}`, { method: 'POST' });
  }

  async cancelBulkJob(jobId) {
    return this.request(`/bulk/cancel/${jobId}`, { method: 'POST' });
  }

  async deleteBulkJob(jobId) {
    return this.request(`/bulk/job/${jobId}`, { method: 'DELETE' });
  }

  async clearCompletedBulkJobs() {
    return this.request('/bulk/completed', { method: 'DELETE' });
  }

  async getAppSettings() {
    return this.request('/settings');
  }

  async updateAppSettings(settings) {
    return this.request('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  }

  async getStats() {
    return this.request('/stats');
  }

  async validateNumbers(phones) {
    return this.request('/messages/validate', {
      method: 'POST',
      body: JSON.stringify({ phones })
    });
  }

  startTerminalStream(onLog, onOpen, onError) {
    this.stopTerminalStream();

    if (!this.baseUrl) {
      if (onError) onError(new Error('Sunucu yapılandırılmadı'));
      return;
    }

    let url = `${this.baseUrl}/api/terminal/stream`;
    if (this.apiKey) {
      url += `?api_key=${encodeURIComponent(this.apiKey)}`;
    }

    try {
      this.terminalEventSource = new EventSource(url);
    } catch (e) {
      console.error('Failed to create terminal EventSource:', e);
      if (onError) onError(new Error('Sunucuya bağlanılamadı'));
      return;
    }

    let terminalHasReceived = false;
    let terminalErrorCount = 0;
    const maxTerminalErrors = 3;

    this.terminalEventSource.onopen = () => {
      console.log('Terminal stream connected');
      terminalHasReceived = true;
      terminalErrorCount = 0;
      if (onOpen) onOpen();
    };

    this.terminalEventSource.onmessage = (event) => {
      terminalHasReceived = true;
      terminalErrorCount = 0;
      try {
        const data = JSON.parse(event.data);
        if (onLog) onLog(data);
      } catch (e) {
        console.error('Terminal SSE parse error:', e);
      }
    };

    this.terminalEventSource.onerror = (error) => {
      console.error('Terminal SSE error:', error);
      terminalErrorCount++;

      if (!terminalHasReceived || terminalErrorCount > maxTerminalErrors) {
        console.error('Terminal stream failed: server unreachable or too many errors');
        this.stopTerminalStream();
        if (onError) onError(new Error('Terminal stream bağlantısı kesildi'));
        return;
      }

      if (onError) onError(error);
    };
  }

  stopTerminalStream() {
    if (this.terminalEventSource) {
      this.terminalEventSource.close();
      this.terminalEventSource = null;
    }
  }

  async clearTerminalLogs() {
    return this.request('/terminal/logs', { method: 'DELETE' });
  }
}

const api = new WhatsAppAPI();
