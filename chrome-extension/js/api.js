/**
 * WhatsApp BOT Manager - API Module
 * Handles all API communications with optimized caching and error handling
 * @version 2.0.0
 */

class WhatsAppAPI {
  /**
   * API Configuration Constants
   */
  static CONFIG = {
    DEFAULT_TIMEOUT: 30000,
    SSE_RETRY_DELAY: 2000,
    SSE_MAX_RETRIES: 3,
    HEARTBEAT_CHECK_INTERVAL: 30000,
    HEARTBEAT_TIMEOUT: 60000,
    STATUS_CACHE_TTL: 5000, // Cache status for 5 seconds
  };

  constructor() {
    this.baseUrl = '';
    this.apiKey = '';
    this.eventSource = null;
    this.messageEventSource = null;
    this.chatEventSource = null;

    // Connection state tracking with caching
    this.lastKnownState = {
      isConnected: false,
      isConnecting: false,
      lastStatusCheck: null,
      pendingStatusCheck: false,
      cachedStatus: null,
    };

    // SSE retry configuration
    this.sseRetryConfig = {
      maxRetries: WhatsAppAPI.CONFIG.SSE_MAX_RETRIES,
      retryDelay: WhatsAppAPI.CONFIG.SSE_RETRY_DELAY,
      currentRetry: 0,
    };

    // Request deduplication
    this._pendingRequests = new Map();
  }

  /**
   * Initialize API with stored settings
   */
  async init() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['apiUrl', 'apiKey'], (result) => {
        this.baseUrl = result.apiUrl || 'http://localhost:3000/api';
        this.apiKey = result.apiKey || '';
        resolve();
      });
    });
  }

  /**
   * Save API settings
   */
  async saveSettings(url, key) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ apiUrl: url, apiKey: key }, () => {
        this.baseUrl = url;
        this.apiKey = key;
        resolve();
      });
    });
  }

  /**
   * Get stored settings
   */
  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['apiUrl', 'apiKey'], (result) => {
        resolve({
          apiUrl: result.apiUrl || 'http://localhost:3000/api',
          apiKey: result.apiKey || ''
        });
      });
    });
  }

  /**
   * Make API request with timeout, caching and deduplication
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} API response
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const timeout = options.timeout || WhatsAppAPI.CONFIG.DEFAULT_TIMEOUT;
    const cacheKey = options.method === 'GET' ? `${options.method || 'GET'}:${url}` : null;

    // Check for duplicate pending requests (GET only)
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

    // Create abort controller for timeout
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
        // Clean up pending request
        if (cacheKey) {
          this._pendingRequests.delete(cacheKey);
        }
      }
    })();

    // Store pending request for deduplication
    if (cacheKey) {
      this._pendingRequests.set(cacheKey, requestPromise);
    }

    return requestPromise;
  }

  // ==================== AUTH ====================

  /**
   * Get connection status
   */
  async getStatus() {
    return this.request('/auth/status');
  }

  /**
   * Get QR code for connection
   */
  async getQR() {
    return this.request('/auth/qr');
  }

  /**
   * Logout and disconnect
   */
  async logout() {
    return this.request('/auth/logout', { method: 'POST' });
  }

  /**
   * Cancel connection attempt
   */
  async cancelConnection() {
    return this.request('/auth/cancel', { method: 'POST' });
  }

  /**
   * Start QR code stream (SSE)
   */
  startQRStream(onQR, onConnected, onError, onDisconnected, onTimeout, onReconnecting) {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // SSE doesn't support custom headers, so we append API key as query param
    let url = `${this.baseUrl}/auth/qr/stream`;
    if (this.apiKey) {
      url += `?api_key=${encodeURIComponent(this.apiKey)}`;
    }

    try {
      this.eventSource = new EventSource(url);
    } catch (e) {
      console.error('Failed to create EventSource:', e);
      if (onError) onError(e);
      return;
    }

    let isConnected = false;
    let connectionStabilized = false;
    let stabilizationTimer = null;

    const clearStabilizationTimer = () => {
      if (stabilizationTimer) {
        clearTimeout(stabilizationTimer);
        stabilizationTimer = null;
      }
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'qr' && data.qrCode) {
          // QR geldiğinde bağlantı henüz kurulmadı demek
          isConnected = false;
          connectionStabilized = false;
          clearStabilizationTimer();
          onQR(data.qrCode);
        } else if (data.type === 'connected') {
          isConnected = true;
          // Update last known state immediately
          this.lastKnownState.isConnected = true;
          this.lastKnownState.isConnecting = false;

          onConnected(data.session);

          // Bağlantının stabil olması için bekle
          // Stream kapanmadan önce gerçekten bağlı olduğunu doğrula
          stabilizationTimer = setTimeout(() => {
            connectionStabilized = true;
            console.log('Connection stabilized');
          }, 5000);
        } else if (data.type === 'disconnected') {
          clearStabilizationTimer();
          // Sadece daha önce bağlandıysa ve stabilize olduysa disconnect event'i tetikle
          if (connectionStabilized) {
            isConnected = false;
            this.lastKnownState.isConnected = false;
            if (onDisconnected) onDisconnected(data.reason);
          }
          // Henüz stabilize olmadıysa, muhtemelen reconnecting sürecindeyiz - bekle
        } else if (data.type === 'timeout') {
          clearStabilizationTimer();
          if (onTimeout) onTimeout();
          this.stopQRStream();
        } else if (data.type === 'reconnecting') {
          clearStabilizationTimer();
          // Reconnecting sadece bilgi amaçlı, bağlantı hala devam ediyor
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

      // Bağlantı başarılı olduysa VE stabilize olduysa stream kapanması normal
      if (isConnected && connectionStabilized) {
        console.log('QR stream closed after successful stable connection');
        this.stopQRStream();
        return;
      }

      // Bağlantı sağlandı ama henüz stabilize olmadı - bu 515 error olabilir
      // Bu durumda stream'i kapatma, server tarafı reconnect yapacak
      if (isConnected && !connectionStabilized) {
        console.log('QR stream error during stabilization, server may be reconnecting');
        // Stream'i kapatma, server reconnect event'i gönderecek
        return;
      }

      // SSE bağlantısı kapandığında kontrol et
      if (this.eventSource && this.eventSource.readyState === EventSource.CLOSED) {
        // Önce gerçek durumu kontrol et
        this.verifyConnectionStatus().then(status => {
          if (status.isConnected) {
            // Aslında bağlı, SSE sadece kapanmış
            console.log('SSE closed but API says connected');
            this.lastKnownState.isConnected = true;
            onConnected(status.session);
          } else if (status.isConnecting) {
            // Hala bağlanıyor
            console.log('SSE closed but connection in progress');
          } else {
            // Gerçekten bağlı değil
            if (onDisconnected) onDisconnected('SSE connection closed');
          }
        }).catch(() => {
          // API erişilemedi
          if (onError) onError(error);
        });
      }
      this.stopQRStream();
    };
  }

  /**
   * Verify actual connection status from API with caching
   * @param {boolean} forceRefresh - Force refresh ignoring cache
   * @returns {Promise<Object>} Connection status
   */
  async verifyConnectionStatus(forceRefresh = false) {
    const now = Date.now();

    // Return cached status if still valid
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

  /**
   * Check if QR stream is active
   */
  isQRStreamActive() {
    return this.eventSource !== null && this.eventSource.readyState === EventSource.OPEN;
  }

  /**
   * Stop QR code stream
   */
  stopQRStream() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  // ==================== MESSAGE STREAM (SSE) ====================

  /**
   * Start global message stream (all incoming messages)
   * Used in chats tab to show unread notifications
   */
  startMessageStream(onMessage, onInit, onError) {
    if (this.messageEventSource) {
      this.messageEventSource.close();
    }

    let url = `${this.baseUrl}/messages/stream`;
    if (this.apiKey) {
      url += `?api_key=${encodeURIComponent(this.apiKey)}`;
    }

    // Track last successful heartbeat
    let lastHeartbeat = Date.now();
    let heartbeatCheckInterval = null;
    let reconnectTimeout = null;

    const startHeartbeatCheck = () => {
      if (heartbeatCheckInterval) clearInterval(heartbeatCheckInterval);
      heartbeatCheckInterval = setInterval(() => {
        // Heartbeat 60 saniyeden fazla gelmemişse, bağlantı kopmuş olabilir
        if (Date.now() - lastHeartbeat > 60000) {
          console.warn('No heartbeat for 60s, checking connection...');
          this.verifyConnectionStatus().then(status => {
            if (status.isConnected && this.messageEventSource?.readyState !== EventSource.OPEN) {
              // Bağlı ama SSE kopmuş, yeniden başlat
              console.log('Reconnecting message stream...');
              this.stopMessageStream();
              setTimeout(() => {
                this.startMessageStream(onMessage, onInit, onError);
              }, 1000);
            }
          }).catch(() => {});
        }
      }, 30000);
    };

    const cleanup = () => {
      if (heartbeatCheckInterval) {
        clearInterval(heartbeatCheckInterval);
        heartbeatCheckInterval = null;
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };

    this.messageEventSource = new EventSource(url);

    this.messageEventSource.onopen = () => {
      console.log('Message stream connected');
      this.sseRetryConfig.currentRetry = 0;
      startHeartbeatCheck();
    };

    this.messageEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'init':
            if (onInit) onInit(data);
            break;
          case 'message':
            if (onMessage) onMessage(data.data);
            break;
          case 'connected':
            this.lastKnownState.isConnected = true;
            this.lastKnownState.isConnecting = false;
            if (onInit) onInit({ isConnected: true, session: data.session });
            break;
          case 'disconnected':
            // SSE disconnected event'ı geldi, ama gerçekten kopmuş mu kontrol et
            // Eğer isConnecting true ise, bu reconnecting durumunda - görmezden gel
            if (data.isConnecting) {
              console.log('Disconnected event received but reconnecting, ignoring...');
              this.lastKnownState.isConnecting = true;
              break;
            }

            this.verifyConnectionStatus().then(status => {
              if (!status.isConnected && !status.isConnecting) {
                this.lastKnownState.isConnected = false;
                this.lastKnownState.isConnecting = false;
                if (onInit) onInit({ isConnected: false, reason: data.reason });
              }
              // Eğer hala bağlı veya bağlanıyorsa, bu geçici bir durum olabilir - görmezden gel
            }).catch(() => {
              // API erişilemedi - muhtemelen gerçekten kopmuş
              this.lastKnownState.isConnected = false;
              if (onInit) onInit({ isConnected: false, reason: data.reason });
            });
            break;
          case 'reconnecting':
            // Reconnecting durumu - bağlantı kesilmedi, yeniden bağlanıyor
            console.log('Reconnecting event received:', data);
            this.lastKnownState.isConnecting = true;
            this.lastKnownState.isConnected = false;
            // UI'a reconnecting durumunu bildirme - sadece log yap
            break;
          case 'heartbeat':
            // Keep-alive - update timestamp
            lastHeartbeat = Date.now();
            break;
        }
      } catch (e) {
        console.error('Message SSE parse error:', e);
      }
    };

    this.messageEventSource.onerror = (error) => {
      console.error('Message SSE error:', error);
      cleanup();

      // SSE hatası aldık ama bu her zaman gerçek disconnect anlamına gelmez
      // Önce gerçek durumu kontrol et
      if (this.sseRetryConfig.currentRetry < this.sseRetryConfig.maxRetries) {
        this.sseRetryConfig.currentRetry++;
        console.log(`SSE error, will retry (${this.sseRetryConfig.currentRetry}/${this.sseRetryConfig.maxRetries})`);

        // Kısa bir bekleme ile yeniden bağlan
        reconnectTimeout = setTimeout(() => {
          this.verifyConnectionStatus().then(status => {
            if (status.isConnected) {
              // Hala bağlı, SSE'yi yeniden başlat
              this.stopMessageStream();
              this.startMessageStream(onMessage, onInit, onError);
            } else {
              // Gerçekten bağlı değil
              if (onInit) onInit({ isConnected: false, reason: 'SSE connection lost' });
            }
          }).catch(() => {
            // API erişilemedi
            if (onError) onError(error);
            this.stopMessageStream();
          });
        }, this.sseRetryConfig.retryDelay * this.sseRetryConfig.currentRetry);
      } else {
        // Max retry reached
        console.error('Max SSE retries reached');
        if (onError) onError(error);
        this.stopMessageStream();
      }
    };
  }

  /**
   * Check if message stream is active
   */
  isMessageStreamActive() {
    return this.messageEventSource !== null && this.messageEventSource.readyState === EventSource.OPEN;
  }

  /**
   * Stop global message stream
   */
  stopMessageStream() {
    if (this.messageEventSource) {
      this.messageEventSource.close();
      this.messageEventSource = null;
    }
  }

  /**
   * Start chat-specific message stream (for active chat view)
   */
  startChatStream(jid, onMessage, onInit, onError) {
    if (this.chatEventSource) {
      this.chatEventSource.close();
    }

    let url = `${this.baseUrl}/messages/stream?jid=${encodeURIComponent(jid)}`;
    if (this.apiKey) {
      url += `&api_key=${encodeURIComponent(this.apiKey)}`;
    }

    let chatRetryCount = 0;
    const maxChatRetries = 3;
    let reconnectTimer = null;

    const cleanup = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    this.chatEventSource = new EventSource(url);

    this.chatEventSource.onopen = () => {
      console.log('Chat stream connected for:', jid);
      chatRetryCount = 0;
    };

    this.chatEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'init':
            if (onInit) onInit(data);
            break;
          case 'message':
            if (onMessage) onMessage(data.data);
            break;
          case 'sent':
            if (onMessage) onMessage({ ...data.data, fromMe: true });
            break;
          case 'heartbeat':
            // Keep-alive, ignore
            break;
        }
      } catch (e) {
        console.error('Chat SSE parse error:', e);
      }
    };

    this.chatEventSource.onerror = (error) => {
      console.error('Chat SSE error:', error);
      cleanup();

      // Chat stream hatası - ama bu her zaman bir sorun değil
      // API bağlantısı var mı kontrol et
      if (chatRetryCount < maxChatRetries) {
        chatRetryCount++;
        console.log(`Chat SSE error, will retry (${chatRetryCount}/${maxChatRetries})`);

        reconnectTimer = setTimeout(() => {
          // Sadece lastKnownState üzerinden kontrol et - API çağrısı yapmadan
          if (this.lastKnownState.isConnected) {
            this.stopChatStream();
            this.startChatStream(jid, onMessage, onInit, onError);
          } else {
            if (onError) onError(error);
          }
        }, 2000 * chatRetryCount);
      } else {
        if (onError) onError(error);
        this.stopChatStream();
      }
    };
  }

  /**
   * Check if chat stream is active
   */
  isChatStreamActive() {
    return this.chatEventSource !== null && this.chatEventSource.readyState === EventSource.OPEN;
  }

  /**
   * Stop chat-specific message stream
   */
  stopChatStream() {
    if (this.chatEventSource) {
      this.chatEventSource.close();
      this.chatEventSource = null;
    }
  }

  // ==================== MESSAGES ====================

  /**
   * Send a message
   */
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
    }

    return this.request('/messages/send', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  /**
   * Get message history for a chat
   */
  async getMessageHistory(jid, limit = 50, page = 1) {
    return this.request(`/messages/history/${encodeURIComponent(jid)}?limit=${limit}&page=${page}`);
  }

  /**
   * Get all chats
   */
  async getChats(filters = {}) {
    const params = new URLSearchParams();

    if (filters.archived !== undefined) params.append('archived', filters.archived);
    if (filters.unread) params.append('unread', 'true');
    if (filters.search) params.append('search', filters.search);
    if (filters.page) params.append('page', filters.page);
    if (filters.limit) params.append('limit', filters.limit);

    return this.request(`/messages/chats?${params.toString()}`);
  }

  /**
   * Check if phone number is on WhatsApp
   */
  async checkNumber(phone) {
    return this.request(`/messages/check/${encodeURIComponent(phone)}`);
  }

  /**
   * Get profile info
   */
  async getProfile(jid) {
    return this.request(`/messages/profile/${encodeURIComponent(jid)}`);
  }

  /**
   * Send typing indicator
   */
  async sendTyping(jid, type = 'composing') {
    return this.request(`/messages/typing/${encodeURIComponent(jid)}`, {
      method: 'POST',
      body: JSON.stringify({ type })
    });
  }

  /**
   * Mark messages as read
   */
  async markAsRead(jid) {
    return this.request(`/messages/read/${encodeURIComponent(jid)}`, {
      method: 'POST'
    });
  }


  /**
   * Get chat stats
   */
  async getChatStats() {
    return this.request('/messages/stats');
  }

  // ==================== SCHEDULED MESSAGES ====================

  /**
   * Schedule a message
   */
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
      payload.caption = mediaOptions.caption;
    }

    return this.request('/messages/schedule', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  /**
   * Get all scheduled messages
   */
  async getScheduledMessages() {
    return this.request('/messages/scheduled');
  }

  /**
   * Get a specific scheduled message
   */
  async getScheduledMessage(id) {
    return this.request(`/messages/scheduled/${id}`);
  }

  /**
   * Update a scheduled message
   */
  async updateScheduledMessage(id, updates) {
    return this.request(`/messages/scheduled/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  }

  /**
   * Cancel a scheduled message
   */
  async cancelScheduledMessage(id) {
    return this.request(`/messages/scheduled/${id}`, {
      method: 'DELETE'
    });
  }

  /**
   * Clear completed scheduled messages
   */
  async clearCompletedScheduled() {
    return this.request('/messages/scheduled/completed', {
      method: 'DELETE'
    });
  }

  // ==================== BULK MESSAGING ====================

  /**
   * Create a bulk send job
   */
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
      payload.caption = options.caption;
    }

    if (options.timeWindow) {
      payload.timeWindow = options.timeWindow;
    }

    if (options.scheduledAt) {
      payload.scheduledAt = options.scheduledAt;
    }

    return this.request('/bulk/send', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  /**
   * Get all bulk jobs
   */
  async getBulkJobs() {
    return this.request('/bulk/jobs');
  }

  /**
   * Get bulk job status
   */
  async getBulkJobStatus(jobId) {
    return this.request(`/bulk/status/${jobId}`);
  }

  /**
   * Get detailed bulk job status
   */
  async getBulkJobDetailedStatus(jobId) {
    return this.request(`/bulk/status/${jobId}/detailed`);
  }

  /**
   * Pause a bulk job
   */
  async pauseBulkJob(jobId) {
    return this.request(`/bulk/pause/${jobId}`, { method: 'POST' });
  }

  /**
   * Resume a bulk job
   */
  async resumeBulkJob(jobId) {
    return this.request(`/bulk/resume/${jobId}`, { method: 'POST' });
  }

  /**
   * Cancel a bulk job
   */
  async cancelBulkJob(jobId) {
    return this.request(`/bulk/cancel/${jobId}`, { method: 'POST' });
  }

  /**
   * Delete a bulk job
   */
  async deleteBulkJob(jobId) {
    return this.request(`/bulk/job/${jobId}`, { method: 'DELETE' });
  }


  /**
   * Clear completed bulk jobs
   */
  async clearCompletedBulkJobs() {
    return this.request('/bulk/completed', { method: 'DELETE' });
  }

  // ==================== SETTINGS ====================

  /**
   * Get settings
   */
  async getAppSettings() {
    return this.request('/settings');
  }

  /**
   * Update settings
   */
  async updateAppSettings(settings) {
    return this.request('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  }

  // ==================== STATS ====================

  /**
   * Get all stats
   */
  async getStats() {
    return this.request('/stats');
  }
}

// Export singleton instance
const api = new WhatsAppAPI();
