const utils = {
  _cache: new Map(),
  _cacheMaxSize: 100,

  clearCache() {
    this._cache.clear();
  },

  memoize(fn, keyFn = (...args) => JSON.stringify(args)) {
    return (...args) => {
      const key = keyFn(...args);
      if (this._cache.has(key)) {
        return this._cache.get(key);
      }
      const result = fn(...args);
      if (this._cache.size >= this._cacheMaxSize) {
        const firstKey = this._cache.keys().next().value;
        this._cache.delete(firstKey);
      }
      this._cache.set(key, result);
      return result;
    };
  },

  toast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-exclamation-circle';
    if (type === 'warning') icon = 'fa-exclamation-triangle';

    toast.innerHTML = `<i class="fas ${icon}"></i> ${this.escapeHtml(message)}`;
    toast.style.setProperty('--toast-duration', duration + 'ms');
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  normalizePhone(phone) {
    if (!phone) return '';
    let cleaned = phone.replace(/[^\d]/g, '');
    cleaned = cleaned.replace(/^0+/, '');
    if (cleaned.length === 10 && !cleaned.startsWith('90')) {
      cleaned = '90' + cleaned;
    }
    return cleaned;
  },

  formatPhone(phone) {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');

    if (cleaned.length >= 10) {
      const countryCode = cleaned.slice(0, -10);
      const rest = cleaned.slice(-10);
      const area = rest.slice(0, 3);
      const first = rest.slice(3, 6);
      const last = rest.slice(6);

      if (countryCode) {
        return `+${countryCode} ${area} ${first} ${last}`;
      }
      return `${area} ${first} ${last}`;
    }

    return phone;
  },

  formatJid(jid) {
    if (!jid) return '';
    return jid.split('@')[0].split(':')[0];
  },

  formatDate(date, format = 'short') {
    if (!date) return '-';

    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';

    const now = new Date();
    const diff = now - d;
    const oneDay = 24 * 60 * 60 * 1000;

    if (format === 'relative') {
      if (diff < 60000) return 'Az önce';
      if (diff < 3600000) return `${Math.floor(diff / 60000)} dk önce`;
      if (diff < oneDay) return `${Math.floor(diff / 3600000)} saat önce`;
      if (diff < oneDay * 7) return `${Math.floor(diff / oneDay)} gün önce`;
    }

    if (format === 'time') {
      return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    }

    if (format === 'short') {
      if (diff < oneDay && d.getDate() === now.getDate()) {
        return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      }
      return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
    }

    return d.toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  formatUptime(seconds) {
    if (!seconds || seconds < 0) return '-';

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts = [];
    if (days > 0) parts.push(`${days}g`);
    if (hours > 0) parts.push(`${hours}s`);
    if (minutes > 0) parts.push(`${minutes}dk`);

    return parts.join(' ') || '< 1dk';
  },

  formatBytes(bytes) {
    if (!bytes) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;

    while (bytes >= 1024 && i < units.length - 1) {
      bytes /= 1024;
      i++;
    }

    return `${bytes.toFixed(1)} ${units[i]}`;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  truncate(text, maxLength = 50) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  },

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },

  getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  parseRecipients(text) {
    return text
      .split(/[\n,;]/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => this.normalizePhone(line))
      .filter(phone => phone.length >= 10 && phone.length <= 15);
  },

  createAvatar(name, size = 44) {
    const initial = (name || '?').charAt(0).toUpperCase();
    return `<div class="chat-avatar" style="width: ${size}px; height: ${size}px;">${initial}</div>`;
  },

  getStatusClass(status) {
    const statusMap = {
      'active': 'active',
      'processing': 'active',
      'paused': 'paused',
      'completed': 'completed',
      'done': 'completed',
      'sent': 'completed',
      'failed': 'failed',
      'error': 'failed',
      'cancelled': 'cancelled',
      'pending': 'pending',
      'scheduled': 'pending'
    };
    return statusMap[status?.toLowerCase()] || 'pending';
  },

  formatMessagePreview(message) {
    if (!message) return '';

    const type = message.type || 'text';

    if (type === 'image') return '📷 Fotoğraf';
    if (type === 'video') return '📹 Video';
    if (type === 'audio') return '🎵 Ses';
    if (type === 'ptt') return '🎤 Sesli Mesaj';
    if (type === 'document') return '📄 Belge';
    if (type === 'sticker') return '🎨 Çıkartma';
    if (type === 'location') return '📍 Konum';
    if (type === 'liveLocation') return '📡 Canlı Konum';
    if (type === 'vcard' || type === 'contact') return '👤 Kişi';
    if (type === 'poll') return '📊 Anket';
    if (type === 'event') return '📅 Etkinlik';

    return utils.truncate(message.content || message.message || '', 40);
  },

  isValidPhone(phone) {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length >= 10 && cleaned.length <= 15;
  },

  toLocalISOString(date) {
    const d = new Date(date);
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  },

  getMinScheduleDate() {
    // Geçmiş/çok yakın saat seçilmesin: en erken "şu an + 10 dk".
    const date = new Date();
    date.setMinutes(date.getMinutes() + 10);
    return this.toLocalISOString(date);
  },

  show(element) {
    if (typeof element === 'string') {
      element = document.getElementById(element) || document.querySelector(element);
    }
    if (element) element.classList.remove('hidden');
  },

  hide(element) {
    if (typeof element === 'string') {
      element = document.getElementById(element) || document.querySelector(element);
    }
    if (element) element.classList.add('hidden');
  },

  toggle(element, show) {
    if (show) {
      this.show(element);
    } else {
      this.hide(element);
    }
  },

  initTooltips() {
    document.addEventListener('mouseover', (e) => {
      const tooltip = e.target.closest('.info-tooltip');
      if (!tooltip) return;

      const rect = tooltip.getBoundingClientRect();
      const tooltipWidth = 200;
      const tooltipPad = 10;
      const viewW = document.documentElement.clientWidth || 720;
      const viewH = document.documentElement.clientHeight || 580;

      let left = rect.left;
      if (left + tooltipWidth > viewW - tooltipPad) {
        left = viewW - tooltipWidth - tooltipPad;
      }
      if (left < tooltipPad) {
        left = tooltipPad;
      }

      let top = rect.bottom + 6;
      const approxHeight = 60;
      if (top + approxHeight > viewH - tooltipPad) {
        top = rect.top - approxHeight - 6;
      }
      if (top < tooltipPad) {
        top = tooltipPad;
      }

      tooltip.style.setProperty('--tip-left', left + 'px');
      tooltip.style.setProperty('--tip-top', top + 'px');
    });
  },

  setLoading(button, loading, text = null) {
    if (typeof button === 'string') {
      button = document.getElementById(button);
    }
    if (!button) return;

    if (loading) {
      button.disabled = true;
      button.dataset.originalText = button.innerHTML;
      button.innerHTML = '<span class="spinner"></span> ' + (text || 'Yükleniyor...');
    } else {
      button.disabled = false;
      if (button.dataset.originalText) {
        button.innerHTML = button.dataset.originalText;
      }
    }
  },

  showConfirm(message) {
    return new Promise((resolve) => {
      const backdrop = document.getElementById('confirm-backdrop');
      const dialog = document.getElementById('confirm-dialog');
      const msgEl = document.getElementById('confirm-message');
      const okBtn = document.getElementById('confirm-ok-btn');
      const cancelBtn = document.getElementById('confirm-cancel-btn');

      if (!backdrop || !dialog) {
        resolve(window.confirm(message));
        return;
      }

      msgEl.textContent = message;
      backdrop.classList.remove('hidden');
      dialog.classList.remove('hidden');

      const cleanup = () => {
        backdrop.classList.add('hidden');
        dialog.classList.add('hidden');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        backdrop.removeEventListener('click', onCancel);
      };

      const onOk = () => { cleanup(); resolve(true); };
      const onCancel = () => { cleanup(); resolve(false); };

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      backdrop.addEventListener('click', onCancel);
    });
  }
};
