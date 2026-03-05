/**********************************************************************/
/*                                                                    */
/* Programmable Logic Controller Cloud Service                        */
/*                                                                    */
/* Copyright (C) 2026 Denisov Foundation Limited                      */
/* License: GPLv3                                                     */
/* Written by Sergey Denisov aka LittleBuster                         */
/* Email: DenisovFoundationLtd@gmail.com                              */
/*                                                                    */
/**********************************************************************/
function esc(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function onOffDot(flag) {
  return `<span class="status-dot ${flag ? 'status-on' : 'status-off'}"></span>`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatTemperature(value, digits = null) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  const text = digits === null ? String(num) : num.toFixed(digits);
  return `${text} &deg;C`;
}

const OBJECT_ICON_OPTIONS = [
  { value: 'apartment', label: 'Квартира' },
  { value: 'house', label: 'Частный дом' },
  { value: 'dacha', label: 'Дача' },
  { value: 'garage', label: 'Гараж' },
  { value: 'garden', label: 'Сад' }
];

function normalizeObjectItem(raw) {
  if (typeof raw === 'string') {
    return { name: raw, icon: 'house' };
  }
  return {
    name: String(raw?.name || ''),
    icon: String(raw?.icon || 'house')
  };
}

function objectIconSvg(icon) {
  const kind = String(icon || 'house').toLowerCase();
  if (kind === 'apartment') {
    return `
      <svg class="object-icon" viewBox="0 0 64 64" aria-hidden="true">
        <path fill="currentColor" d="M14 6h36c2.2 0 4 1.8 4 4v46c0 2.2-1.8 4-4 4H14c-2.2 0-4-1.8-4-4V10c0-2.2 1.8-4 4-4zm0 4v46h36V10H14z"/>
        <rect x="20" y="16" width="6" height="6" fill="currentColor"/>
        <rect x="30" y="16" width="6" height="6" fill="currentColor"/>
        <rect x="40" y="16" width="6" height="6" fill="currentColor"/>
        <rect x="20" y="28" width="6" height="6" fill="currentColor"/>
        <rect x="30" y="28" width="6" height="6" fill="currentColor"/>
        <rect x="40" y="28" width="6" height="6" fill="currentColor"/>
        <rect x="28" y="42" width="8" height="14" fill="currentColor"/>
      </svg>
    `;
  }
  if (kind === 'dacha') {
    return `
      <svg class="object-icon" viewBox="0 0 64 64" aria-hidden="true">
        <path fill="currentColor" d="M8 30 32 10l24 20v24H8V30zm6 2v16h36V32L32 17 14 32z"/>
        <rect x="28" y="34" width="8" height="14" fill="currentColor"/>
        <path fill="currentColor" d="M48 14h4l4 8h-4z"/>
      </svg>
    `;
  }
  if (kind === 'garage') {
    return `
      <svg class="object-icon" viewBox="0 0 64 64" aria-hidden="true">
        <path fill="currentColor" d="M6 30 32 12l26 18v24H6V30zm6 2v16h40V32L32 18 12 32z"/>
        <rect x="20" y="34" width="24" height="14" fill="currentColor"/>
        <path fill="#0b1220" d="M22 38h20v2H22zm0 4h20v2H22z"/>
      </svg>
    `;
  }
  if (kind === 'garden') {
    return `
      <svg class="object-icon" viewBox="0 0 64 64" aria-hidden="true">
        <path fill="currentColor" d="M30 6h4v20h-4z"/>
        <circle cx="32" cy="24" r="10" fill="currentColor"/>
        <circle cx="22" cy="28" r="8" fill="currentColor"/>
        <circle cx="42" cy="28" r="8" fill="currentColor"/>
        <path fill="currentColor" d="M10 50c8-6 14-6 22 0 8-6 14-6 22 0v6H10z"/>
      </svg>
    `;
  }
  return `
    <svg class="object-icon" viewBox="0 0 64 64" aria-hidden="true">
      <path fill="currentColor" d="M32 8 10 26v30h17V39h10v17h17V26L32 8zm0 6.4L50 28v24h-9V35H23v17h-9V28l18-13.6z"/>
    </svg>
  `;
}

function summarizeControllers(controllers = {}) {
  const sockets = asArray(controllers.sockets);
  const lights = asArray(controllers.lights);
  const meteo = asArray(controllers.meteo);
  const thermo = asArray(controllers.thermo);
  const tanks = asArray(controllers.tanks);
  const septic = asArray(controllers.septic);
  const watering = asArray(controllers.watering);
  const leak = asArray(controllers.leak);

  return [
    {
      key: 'sockets',
      title: 'Розетки',
      status: `${sockets.filter(x => x.state).length}/${sockets.length}`,
      online: sockets.some(x => x.enabled)
    },
    {
      key: 'lights',
      title: 'Освещение',
      status: `${lights.filter(x => x.state).length}/${lights.length}`,
      online: lights.some(x => x.enabled)
    },
    {
      key: 'meteo',
      title: 'Метео',
      status: `${meteo.filter(x => x.ok).length}/${meteo.length}`,
      online: meteo.some(x => x.enabled)
    },
    {
      key: 'thermo',
      title: 'Термостаты',
      status: `${thermo.filter(x => x.heat_on || x.cool_on).length}/${thermo.length}`,
      online: thermo.some(x => x.enabled)
    },
    {
      key: 'tanks',
      title: 'Баки',
      status: `${tanks.filter(x => x.pump_on || x.alarm_on).length}/${tanks.length}`,
      online: tanks.some(x => x.enabled)
    },
    {
      key: 'septic',
      title: 'Септик',
      status: `${septic.filter(x => x.warning || x.alarm).length}/${septic.length}`,
      online: septic.some(x => x.enabled)
    },
    {
      key: 'watering',
      title: 'Полив',
      status: `${watering.filter(x => x.active).length}/${watering.length}`,
      online: watering.some(x => x.enabled)
    },
    {
      key: 'security',
      title: 'Охрана',
      status: controllers.security ? (controllers.security.alarm ? 'Тревога' : (controllers.security.armed ? 'На охране' : 'Снято')) : '-',
      online: Boolean(controllers.security?.enabled)
    },
    {
      key: 'ring',
      title: 'Звонок',
      status: controllers.ring ? (controllers.ring.relay_on ? 'Вкл' : 'Выкл') : '-',
      online: Boolean(controllers.ring?.enabled)
    },
    {
      key: 'avr',
      title: 'АВР',
      status: controllers.avr ? `${controllers.avr.active_source || '-'}${controllers.avr.fault && controllers.avr.fault !== 'none' ? ` / ${controllers.avr.fault}` : ''}` : '-',
      online: Boolean(controllers.avr?.enabled)
    },
    {
      key: 'leak',
      title: 'Протечки',
      status: `${leak.filter(x => x.wet || x.alarm_latched).length}/${leak.length}`,
      online: leak.some(x => x.enabled)
    }
  ];
}

function controllerIconSvg(key) {
  const k = String(key || '').toLowerCase();
  if (k === 'lights') return '<path d="M12 3a6 6 0 0 0-3.8 10.7V17h7.6v-3.3A6 6 0 0 0 12 3Z"/><path d="M9 20h6"/><path d="M9.6 17h4.8"/>';
  if (k === 'sockets') return '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M10 14h4v3h-4z"/>';
  if (k === 'security') return '<path d="M12 3 5 6v5c0 4.4 3 8.5 7 10 4-1.5 7-5.6 7-10V6z"/><path d="M9 12l2 2 4-4"/>';
  if (k === 'meteo') return '<path d="M7 16h9a3.5 3.5 0 0 0 .3-7A4.8 4.8 0 0 0 7.7 7.6 3.7 3.7 0 0 0 7 16Z"/><path d="M11 10v5"/><circle cx="11" cy="17" r="2.2"/>';
  if (k === 'thermo') return '<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 7v8"/><circle cx="12" cy="16" r="3"/><path d="M18.5 7.5h1.5"/><path d="M18.5 11.5h1.5"/><path d="M18.5 15.5h1.5"/>';
  if (k === 'tanks') return '<rect x="6" y="4" width="12" height="16" rx="3"/><path d="M8 13h8"/>';
  if (k === 'septic') return '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M8 11h8M8 15h8"/>';
  if (k === 'watering') return '<path d="M4 14h9v4h3v-4h2c2.2 0 4 1.8 4 4"/><path d="M19 20a2 2 0 0 1-4 0c0-1.3 2-3 2-3s2 1.7 2 3Z"/>';
  if (k === 'ring') return '<circle cx="12" cy="12" r="8"/><path d="M9 12h6"/><path d="M12 9v6"/>';
  if (k === 'avr') return '<path d="M4 12h16"/><path d="M12 4v16"/><circle cx="12" cy="12" r="3"/>';
  if (k === 'leak') return '<path d="M12 4c3 5 6 8 6 11a6 6 0 0 1-12 0c0-3 3-6 6-11Z"/>';
  return '<circle cx="12" cy="12" r="8"/>';
}

function thermoStatusVisualSvg(mode, heatOn, coolOn) {
  const normalized = String(mode || '').toLowerCase();
  const heatSvg = '<svg class="icon heat ' + (heatOn ? 'active' : 'inactive') + '" viewBox="0 0 120 120" aria-hidden="true"><rect x="22" y="30" width="76" height="60" rx="10"/><line x1="36" y1="40" x2="36" y2="80"/><line x1="52" y1="40" x2="52" y2="80"/><line x1="68" y1="40" x2="68" y2="80"/><line x1="84" y1="40" x2="84" y2="80"/></svg>';
  const coolSvg = '<svg class="icon cool ' + (coolOn ? 'active' : 'inactive') + '" viewBox="0 0 120 120" aria-hidden="true"><rect x="18" y="28" width="84" height="46" rx="10"/><line x1="28" y1="44" x2="92" y2="44"/><line x1="28" y1="56" x2="92" y2="56"/><line x1="40" y1="78" x2="34" y2="92"/><line x1="60" y1="78" x2="60" y2="94"/><line x1="80" y1="78" x2="86" y2="92"/></svg>';
  if (normalized === 'heat' || normalized === 'heat_only') return heatSvg;
  if (normalized === 'cool' || normalized === 'cool_only') return coolSvg;
  if (normalized === 'off') return '';
  return `${heatSvg}${coolSvg}`;
}

export class Ui {
  constructor({ state }) {
    this.state = state;

    this.loginView = document.getElementById('loginView');
    this.objectsView = document.getElementById('objectsView');
    this.settingsView = document.getElementById('settingsView');
    this.devicesView = document.getElementById('devicesView');
    this.deviceView = document.getElementById('deviceView');
    this.deviceControllersView = document.getElementById('deviceControllersView');
    this.deviceSocketsView = document.getElementById('deviceSocketsView');
    this.deviceLightsView = document.getElementById('deviceLightsView');
    this.deviceTanksView = document.getElementById('deviceTanksView');
    this.deviceSecurityView = document.getElementById('deviceSecurityView');
    this.deviceMeteoView = document.getElementById('deviceMeteoView');
    this.deviceThermoView = document.getElementById('deviceThermoView');
    this.deviceSepticView = document.getElementById('deviceSepticView');
    this.deviceWateringView = document.getElementById('deviceWateringView');
    this.deviceRingView = document.getElementById('deviceRingView');
    this.deviceAvrView = document.getElementById('deviceAvrView');
    this.deviceLeakView = document.getElementById('deviceLeakView');
    this.deviceNetworkView = document.getElementById('deviceNetworkView');

    this.mainMenu = document.getElementById('mainMenu');
    this.menuObjectsBtn = document.getElementById('menuObjects');
    this.menuDevicesBtn = document.getElementById('menuDevices');
    this.menuSettingsBtn = document.getElementById('menuSettings');
    this.topMenu = document.getElementById('topMenu');
    this.menuStatusBtn = document.getElementById('menuStatus');
    this.menuControllersBtn = document.getElementById('menuControllers');
    this.menuNetworkBtn = document.getElementById('menuNetwork');
    this.statusEl = document.getElementById('status');
    this.logoutBtn = document.getElementById('logoutBtn');
    this.loginForm = document.getElementById('loginForm');
    this.objectsList = document.getElementById('objectsList');
    this.adminDevices = document.getElementById('adminDevices');
    this.adminObjects = document.getElementById('adminObjects');
    this.objectForm = document.getElementById('objectForm');
    this.deviceForm = document.getElementById('deviceForm');
    this.deviceObjectSelect = document.getElementById('deviceObjectSelect');

    this.devicesList = document.getElementById('devicesList');
    this.devicesEmpty = document.getElementById('devicesEmpty');
    this.devicesObject = document.getElementById('devicesObject');

    this.deviceTitle = document.getElementById('deviceTitle');
    this.deviceControllersTitle = document.getElementById('deviceControllersTitle');
    this.deviceSocketsTitle = document.getElementById('deviceSocketsTitle');
    this.deviceLightsTitle = document.getElementById('deviceLightsTitle');
    this.deviceTanksTitle = document.getElementById('deviceTanksTitle');
    this.deviceSecurityTitle = document.getElementById('deviceSecurityTitle');
    this.deviceMeteoTitle = document.getElementById('deviceMeteoTitle');
    this.deviceNetworkTitle = document.getElementById('deviceNetworkTitle');
    this.deviceStatusBody = document.getElementById('deviceStatusBody');
    this.deviceControllersGrid = document.getElementById('deviceControllersGrid');
    this.deviceSocketsGrid = document.getElementById('deviceSocketsGrid');
    this.deviceLightsGrid = document.getElementById('deviceLightsGrid');
    this.deviceTanksGrid = document.getElementById('deviceTanksGrid');
    this.deviceSecurityGrid = document.getElementById('deviceSecurityGrid');
    this.deviceSecuritySummary = document.getElementById('deviceSecuritySummary');
    this.deviceSecurityActions = document.getElementById('deviceSecurityActions');
    this.deviceMeteoGrid = document.getElementById('deviceMeteoGrid');
    this.deviceThermoGrid = document.getElementById('deviceThermoGrid');
    this.deviceSepticGrid = document.getElementById('deviceSepticGrid');
    this.deviceWateringGrid = document.getElementById('deviceWateringGrid');
    this.deviceRingWrap = document.getElementById('deviceRingWrap');
    this.deviceAvrWrap = document.getElementById('deviceAvrWrap');
    this.deviceLeakActions = document.getElementById('deviceLeakActions');
    this.deviceLeakGrid = document.getElementById('deviceLeakGrid');
    this.deviceWifiBody = document.getElementById('deviceWifiBody');
    this.deviceGsmBody = document.getElementById('deviceGsmBody');
    this.deviceScope = document.getElementById('deviceScope');
    this.socketsScope = document.getElementById('socketsScope');
    this.lightsScope = document.getElementById('lightsScope');
    this.tanksScope = document.getElementById('tanksScope');
    this.securityScope = document.getElementById('securityScope');
    this.meteoScope = document.getElementById('meteoScope');
    this.refreshDeviceBtn = document.getElementById('refreshDevice');
    this.refreshSocketsBtn = document.getElementById('refreshSockets');
    this.refreshLightsBtn = document.getElementById('refreshLights');
    this.refreshTanksBtn = document.getElementById('refreshTanks');
    this.refreshSecurityBtn = document.getElementById('refreshSecurity');
    this.refreshMeteoBtn = document.getElementById('refreshMeteo');
    this.deviceNotice = document.getElementById('deviceNotice');
    this.deviceSocketsNotice = document.getElementById('deviceSocketsNotice');
    this.deviceLightsNotice = document.getElementById('deviceLightsNotice');
    this.deviceTanksNotice = document.getElementById('deviceTanksNotice');
    this.deviceSecurityNotice = document.getElementById('deviceSecurityNotice');
    this.deviceMeteoNotice = document.getElementById('deviceMeteoNotice');
    this.deviceThermoNotice = document.getElementById('deviceThermoNotice');
    this.deviceSepticNotice = document.getElementById('deviceSepticNotice');
    this.deviceWateringNotice = document.getElementById('deviceWateringNotice');
    this.deviceRingNotice = document.getElementById('deviceRingNotice');
    this.deviceAvrNotice = document.getElementById('deviceAvrNotice');
    this.deviceLeakNotice = document.getElementById('deviceLeakNotice');

    this.backToObjects = document.getElementById('backToObjects');
    this.backToDevices = document.getElementById('backToDevices');
    this.backToDevicesFromControllers = document.getElementById('backToDevicesFromControllers');
    this.backToControllersFromSockets = document.getElementById('backToControllersFromSockets');
    this.backToControllersFromLights = document.getElementById('backToControllersFromLights');
    this.backToControllersFromTanks = document.getElementById('backToControllersFromTanks');
    this.backToControllersFromSecurity = document.getElementById('backToControllersFromSecurity');
    this.backToControllersFromMeteo = document.getElementById('backToControllersFromMeteo');
    this.backToControllersFromThermo = document.getElementById('backToControllersFromThermo');
    this.backToControllersFromSeptic = document.getElementById('backToControllersFromSeptic');
    this.backToControllersFromWatering = document.getElementById('backToControllersFromWatering');
    this.backToControllersFromRing = document.getElementById('backToControllersFromRing');
    this.backToControllersFromAvr = document.getElementById('backToControllersFromAvr');
    this.backToControllersFromLeak = document.getElementById('backToControllersFromLeak');
    this.backToDevicesFromNetwork = document.getElementById('backToDevicesFromNetwork');

    this._menuIndicatorRaf = null;
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.refreshMenuIndicators());
    }
  }

  setStatus(text, ok = true) {
    this.statusEl.textContent = text;
    this.statusEl.className = ok ? 'status ok' : 'status error';
  }

  setDeviceNotice(text = '') {
    this.deviceNotice.textContent = text;
  }

  setSocketsNotice(text = '') {
    this.deviceSocketsNotice.textContent = text;
  }

  setMeteoNotice(text = '') {
    this.deviceMeteoNotice.textContent = text;
  }

  setThermoNotice(text = '') {
    if (this.deviceThermoNotice) this.deviceThermoNotice.textContent = text;
  }

  setSepticNotice(text = '') {
    if (this.deviceSepticNotice) this.deviceSepticNotice.textContent = text;
  }

  setWateringNotice(text = '') {
    if (this.deviceWateringNotice) this.deviceWateringNotice.textContent = text;
  }

  setRingNotice(text = '') {
    if (this.deviceRingNotice) this.deviceRingNotice.textContent = text;
  }

  setAvrNotice(text = '') {
    if (this.deviceAvrNotice) this.deviceAvrNotice.textContent = text;
  }

  setLeakNotice(text = '') {
    if (this.deviceLeakNotice) this.deviceLeakNotice.textContent = text;
  }

  setLightsNotice(text = '') {
    this.deviceLightsNotice.textContent = text;
  }

  setTanksNotice(text = '') {
    this.deviceTanksNotice.textContent = text;
  }

  setSecurityNotice(text = '') {
    this.deviceSecurityNotice.textContent = text;
  }

  bindTargetPicker(onChange) {
    this._onTargetPickerChange = typeof onChange === 'function' ? onChange : null;
    const selects = [
      this.deviceScope,
      this.socketsScope,
      this.lightsScope,
      this.tanksScope,
      this.securityScope,
      this.meteoScope
    ].filter(Boolean);
    for (const select of selects) {
      if (select.dataset.boundTargetPicker === '1') continue;
      select.dataset.boundTargetPicker = '1';
      select.addEventListener('change', () => {
        if (!this._onTargetPickerChange) return;
        const raw = String(select.value || 'local');
        if (raw.startsWith('stack:')) {
          const nodeId = Number(raw.slice(6));
          if (Number.isFinite(nodeId) && nodeId > 0) {
            this._onTargetPickerChange('stack', nodeId);
            return;
          }
        }
        this._onTargetPickerChange('local', null);
      });
    }
  }

  renderTargetPicker(options = [], currentUnit = 'local', currentNodeId = null) {
    const selects = [
      this.deviceScope,
      this.socketsScope,
      this.lightsScope,
      this.tanksScope,
      this.securityScope,
      this.meteoScope
    ].filter(Boolean);
    if (!selects.length) return;
    const rows = Array.isArray(options) ? options : [];
    const normalized = rows.map((item) => {
      const unit = item?.unit === 'stack' ? 'stack' : 'local';
      const nodeId = unit === 'stack' ? Number(item?.node_id) : null;
      const value = unit === 'stack' && Number.isFinite(nodeId) && nodeId > 0 ? `stack:${nodeId}` : 'local';
      return {
        value,
        label: String(item?.label || (value === 'local' ? 'Локальное устройство' : `Stack #${nodeId}`))
      };
    });
    const values = new Set(normalized.map((r) => r.value));
    const selectedValue = currentUnit === 'stack' && Number(currentNodeId) > 0 ? `stack:${Number(currentNodeId)}` : 'local';
    const safeValue = values.has(selectedValue) ? selectedValue : 'local';
    for (const select of selects) {
      select.innerHTML = '';
      for (const row of normalized) {
        const opt = document.createElement('option');
        opt.value = row.value;
        opt.textContent = row.label;
        select.appendChild(opt);
      }
      if (!normalized.length) {
        const opt = document.createElement('option');
        opt.value = 'local';
        opt.textContent = 'Локальное устройство';
        select.appendChild(opt);
      }
      select.value = safeValue;
    }
  }

  renderEmptyState(title = 'Нет данных', actionLabel = 'Обновить') {
    return `
      <div class="empty-state">
        <div class="empty-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9"></circle>
            <path d="M12 7v6"></path>
            <circle cx="12" cy="16.8" r="0.8" class="fill"></circle>
          </svg>
        </div>
        <div class="empty-title">${esc(title)}</div>
        <div class="empty-sub">Проверьте соединение или запросите снимок состояния.</div>
        <button class="ghost btn-sm empty-cta" type="button" data-empty-refresh="1">${esc(actionLabel)}</button>
      </div>
    `;
  }

  setContentLoading(flag = false) {
    const targets = [
      this.deviceStatusBody,
      this.deviceControllersGrid,
      this.deviceSocketsGrid,
      this.deviceLightsGrid,
      this.deviceTanksGrid,
      this.deviceSecurityGrid,
      this.deviceMeteoGrid,
      this.deviceThermoGrid,
      this.deviceSepticGrid,
      this.deviceWateringGrid,
      this.deviceRingWrap,
      this.deviceAvrWrap,
      this.deviceLeakGrid,
      this.deviceWifiBody,
      this.deviceGsmBody
    ];
    for (const el of targets) {
      if (!el) continue;
      el.classList.toggle('is-loading', Boolean(flag));
    }
  }

  applyObjectTheme(objectName = '') {
    const body = document.body;
    if (!body) return;
    const name = String(objectName || '').trim();
    if (!name) {
      body.removeAttribute('data-object-theme');
      return;
    }
    const raw = asArray(this.state.objects).find((item) => normalizeObjectItem(item).name === name);
    const icon = normalizeObjectItem(raw || { name, icon: 'house' }).icon;
    body.setAttribute('data-object-theme', icon);
  }

  animateViewTransition(view) {
    const viewMap = {
      login: this.loginView,
      objects: this.objectsView,
      settings: this.settingsView,
      devices: this.devicesView,
      device: this.deviceView,
      deviceControllers: this.deviceControllersView,
      deviceSockets: this.deviceSocketsView,
      deviceLights: this.deviceLightsView,
      deviceTanks: this.deviceTanksView,
      deviceSecurity: this.deviceSecurityView,
      deviceMeteo: this.deviceMeteoView,
      deviceThermo: this.deviceThermoView,
      deviceSeptic: this.deviceSepticView,
      deviceWatering: this.deviceWateringView,
      deviceRing: this.deviceRingView,
      deviceAvr: this.deviceAvrView,
      deviceLeak: this.deviceLeakView,
      deviceNetwork: this.deviceNetworkView
    };
    const el = viewMap[view];
    if (!el) return;
    el.classList.remove('view-enter');
    void el.offsetWidth;
    el.classList.add('view-enter');
  }

  updateMenuIndicator(menuEl) {
    if (!menuEl) return;
    const activeBtn = menuEl.querySelector('.menu-btn.active');
    if (!activeBtn || menuEl.classList.contains('hidden')) {
      menuEl.style.setProperty('--menu-ind-o', '0');
      return;
    }
    const menuRect = menuEl.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    const x = Math.max(0, btnRect.left - menuRect.left);
    const w = Math.max(0, btnRect.width);
    menuEl.style.setProperty('--menu-ind-x', `${x}px`);
    menuEl.style.setProperty('--menu-ind-w', `${w}px`);
    menuEl.style.setProperty('--menu-ind-o', '1');
  }

  refreshMenuIndicators() {
    if (this._menuIndicatorRaf && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this._menuIndicatorRaf);
    }
    if (typeof window === 'undefined') return;
    this._menuIndicatorRaf = window.requestAnimationFrame(() => {
      this.updateMenuIndicator(this.mainMenu);
      this.updateMenuIndicator(this.topMenu);
      this._menuIndicatorRaf = null;
    });
  }

  show(view) {
    this.loginView.classList.toggle('hidden', view !== 'login');
    this.objectsView.classList.toggle('hidden', view !== 'objects');
    this.settingsView.classList.toggle('hidden', view !== 'settings');
    this.devicesView.classList.toggle('hidden', view !== 'devices');
    this.deviceView.classList.toggle('hidden', view !== 'device');
    this.deviceControllersView.classList.toggle('hidden', view !== 'deviceControllers');
    this.deviceSocketsView.classList.toggle('hidden', view !== 'deviceSockets');
    this.deviceLightsView.classList.toggle('hidden', view !== 'deviceLights');
    this.deviceTanksView.classList.toggle('hidden', view !== 'deviceTanks');
    this.deviceSecurityView.classList.toggle('hidden', view !== 'deviceSecurity');
    this.deviceMeteoView.classList.toggle('hidden', view !== 'deviceMeteo');
    this.deviceThermoView.classList.toggle('hidden', view !== 'deviceThermo');
    this.deviceSepticView.classList.toggle('hidden', view !== 'deviceSeptic');
    this.deviceWateringView.classList.toggle('hidden', view !== 'deviceWatering');
    this.deviceRingView.classList.toggle('hidden', view !== 'deviceRing');
    this.deviceAvrView.classList.toggle('hidden', view !== 'deviceAvr');
    this.deviceLeakView.classList.toggle('hidden', view !== 'deviceLeak');
    this.deviceNetworkView.classList.toggle('hidden', view !== 'deviceNetwork');

    const inAuthViews = view !== 'login';
    this.mainMenu.classList.toggle('hidden', !inAuthViews);
    this.menuObjectsBtn.classList.toggle('active', view !== 'login' && view !== 'settings');
    this.menuSettingsBtn.classList.toggle('active', view === 'settings');

    const inDevicePages = view === 'device' || view === 'deviceControllers' || view === 'deviceSockets' || view === 'deviceLights' || view === 'deviceTanks' || view === 'deviceSecurity' || view === 'deviceMeteo' || view === 'deviceThermo' || view === 'deviceSeptic' || view === 'deviceWatering' || view === 'deviceRing' || view === 'deviceAvr' || view === 'deviceLeak' || view === 'deviceNetwork';
    this.topMenu.classList.toggle('hidden', !inDevicePages);
    this.menuStatusBtn.classList.toggle('active', view === 'device');
    this.menuControllersBtn.classList.toggle('active', view === 'deviceControllers' || view === 'deviceSockets' || view === 'deviceLights' || view === 'deviceTanks' || view === 'deviceSecurity' || view === 'deviceMeteo' || view === 'deviceThermo' || view === 'deviceSeptic' || view === 'deviceWatering' || view === 'deviceRing' || view === 'deviceAvr' || view === 'deviceLeak');
    this.menuNetworkBtn.classList.toggle('active', view === 'deviceNetwork');
    this.refreshMenuIndicators();
    this.animateViewTransition(view);
  }

  renderObjects(onSelect) {
    this.objectsList.innerHTML = '';
    this.deviceObjectSelect.innerHTML = '';
    for (const raw of this.state.objects) {
      const obj = normalizeObjectItem(raw);
      const btn = document.createElement('button');
      btn.className = 'object-tile';
      btn.innerHTML = `
        ${objectIconSvg(obj.icon)}
        <span class="object-name">${esc(obj.name)}</span>
      `;
      btn.addEventListener('click', () => onSelect(obj.name));
      this.objectsList.appendChild(btn);

      const opt = document.createElement('option');
      opt.value = obj.name;
      opt.textContent = obj.name;
      this.deviceObjectSelect.appendChild(opt);
    }
  }

  renderDevices(onSelect) {
    this.devicesList.innerHTML = '';
    if (!this.state.devices.length) {
      this.devicesEmpty.classList.remove('hidden');
      this.devicesEmpty.innerHTML = `
        <div class="empty-state compact">
          <div class="empty-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9"></circle>
              <path d="M7 12h10"></path>
            </svg>
          </div>
          <div class="empty-title">Нет устройств онлайн</div>
          <button class="ghost btn-sm empty-cta" type="button" data-empty-devices-refresh="1">Обновить список</button>
        </div>
      `;
      return;
    }
    this.devicesEmpty.classList.add('hidden');
    for (const device of this.state.devices) {
      const btn = document.createElement('button');
      btn.className = 'device-tile';
      btn.innerHTML = `
        <svg class="device-icon" viewBox="0 0 64 64" aria-hidden="true">
          <rect x="8" y="12" width="48" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="4"/>
          <rect x="24" y="24" width="16" height="16" rx="2" fill="currentColor"/>
          <circle cx="18" cy="22" r="2.5" fill="currentColor"/>
          <circle cx="46" cy="22" r="2.5" fill="currentColor"/>
          <circle cx="18" cy="42" r="2.5" fill="currentColor"/>
          <circle cx="46" cy="42" r="2.5" fill="currentColor"/>
          <path d="M6 20h6M6 28h6M6 36h6M6 44h6M52 20h6M52 28h6M52 36h6M52 44h6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        </svg>
        <span class="device-name">${esc(device.name || 'Без имени')}</span>
        <span class="device-id">#${esc(device.device_id)}</span>
      `;
      btn.addEventListener('click', () => onSelect(device));
      this.devicesList.appendChild(btn);
    }
  }

  renderScopeOptions(stack, currentUnit = 'local', currentNodeId = null) {
    if (!this.deviceScope && !this.socketsScope && !this.lightsScope && !this.tanksScope && !this.securityScope && !this.meteoScope) return;
    const nodes = asArray(stack?.nodes);
    const options = [{ value: 'local', label: 'Локальное устройство' }];
    for (const node of nodes) {
      if (!node?.node_id) continue;
      options.push({
        value: `stack:${Number(node.node_id)}`,
        label: `Stack #${Number(node.node_id)}${node.name ? ` - ${node.name}` : ''}`
      });
    }

    const selectedValue = currentUnit === 'stack' && currentNodeId ? `stack:${Number(currentNodeId)}` : 'local';
    const fillSelect = (select) => {
      if (!select) return;
      select.innerHTML = '';
      for (const option of options) {
        const el = document.createElement('option');
        el.value = option.value;
        el.textContent = option.label;
        select.appendChild(el);
      }
      if (options.some(o => o.value === selectedValue)) {
        select.value = selectedValue;
      } else {
        select.value = 'local';
      }
    };

    fillSelect(this.deviceScope);
    fillSelect(this.socketsScope);
    fillSelect(this.lightsScope);
    fillSelect(this.tanksScope);
    fillSelect(this.securityScope);
    fillSelect(this.meteoScope);
  }

  renderDevice(detail) {
    if (!detail) return;

    const system = detail.system || {};
    const rtc = system.rtc || {};
    const plc = system.plc || {};
    const fan = system.fan || {};
    const rtcTemp = formatTemperature(rtc.temp_c);
    const boardTemp = formatTemperature(plc.board_temp, 1);
    const cpuTemp = formatTemperature(plc.cpu_temp);

    this.deviceStatusBody.innerHTML = `
      <tr><td>Имя устройства</td><td><strong>${esc(detail.name || '-')}</strong></td></tr>
      <tr><td>Дата</td><td><strong>${esc(rtc.date || '-')}</strong></td></tr>
      <tr><td>Время</td><td><strong>${esc(rtc.time || '-')}</strong></td></tr>
      <tr><td>RTC температура</td><td><strong>${rtcTemp}</strong></td></tr>
      <tr><td>Температура платы</td><td><strong>${boardTemp}</strong></td></tr>
      <tr><td>CPU</td><td><strong>${cpuTemp}</strong></td></tr>
      <tr><td>Вентилятор</td><td>${onOffDot(Boolean(fan.fan_on))}</td></tr>
      <tr><td>Статус</td><td>${onOffDot(Boolean(detail.online))}</td></tr>
    `;

    const cards = summarizeControllers(detail.controllers);
    this.deviceControllersGrid.innerHTML = cards
      .map(card => `
        <div class="ctrl-card" data-controller="${esc(card.key)}">
          <div class="ctrl-icon-wrap" aria-hidden="true">
            <svg class="ctrl-icon-svg" viewBox="0 0 24 24">
              ${controllerIconSvg(card.key)}
            </svg>
          </div>
          <div class="ctrl-main">
            <div class="ctrl-head">
              <span class="ctrl-title">${esc(card.title)}</span>
              ${onOffDot(card.online)}
            </div>
            <div class="ctrl-sub">${card.online ? 'онлайн' : 'оффлайн'}</div>
            <div class="ctrl-value">${esc(card.status)}</div>
          </div>
        </div>
      `)
      .join('');

  }

  renderSockets(detail) {
    const sockets = asArray(detail?.controllers?.sockets);
    if (!sockets.length) {
      this.deviceSocketsGrid.innerHTML = this.renderEmptyState('Нет данных по розеткам');
      return;
    }

    this.deviceSocketsGrid.innerHTML = sockets.map(socket => {
      const on = Boolean(socket.state);
      const enabled = Boolean(socket.enabled);
      return `
        <article class="socket-tile ${enabled ? '' : 'disabled'}" data-socket-id="${Number(socket.id)}">
          <div class="socket-visual ${on ? 'on' : 'off'}">
            <span class="socket-chip">#${Number(socket.id)}</span>
            <svg class="sock-icon ${on ? 'on' : 'off'}" viewBox="0 0 64 64" aria-hidden="true">
              <path fill="currentColor" d="M16 10h32c3.3 0 6 2.7 6 6v32c0 3.3-2.7 6-6 6H16c-3.3 0-6-2.7-6-6V16c0-3.3 2.7-6 6-6zm0 4c-1.1 0-2 .9-2 2v32c0 1.1.9 2 2 2h32c1.1 0 2-.9 2-2V16c0-1.1-.9-2-2-2H16z"/>
              <circle cx="24" cy="26" r="4" fill="currentColor"/>
              <circle cx="40" cy="26" r="4" fill="currentColor"/>
              <rect x="28" y="36" width="8" height="10" rx="2" fill="currentColor"/>
            </svg>
          </div>
          <div class="socket-main">
            <div class="socket-head">
              <div class="socket-name">${esc(socket.name || `Розетка ${Number(socket.id)}`)}</div>
              ${onOffDot(on)}
            </div>
            <div class="socket-meta">${!enabled ? 'Отключена' : (on ? 'Включена' : 'Выключена')}</div>
            <div class="socket-pending-text">Ожидание...</div>
            <div class="socket-actions">
              <button class="ghost btn-sm ${on ? 'btn-off' : 'btn-on'}" data-action="toggle" ${enabled ? '' : 'disabled'}>${on ? 'Статус ВЫКЛ' : 'Статус ВКЛ'}</button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  renderMeteo(detail) {
    const meteo = asArray(detail?.controllers?.meteo);
    if (!meteo.length) {
      this.deviceMeteoGrid.innerHTML = this.renderEmptyState('Нет данных по метео');
      return;
    }

    this.deviceMeteoGrid.innerHTML = meteo.map(sensor => {
      const ok = Boolean(sensor.ok);
      const enabled = Boolean(sensor.enabled);
      const hasTemp = Boolean(sensor.has_temp);
      const hasHum = Boolean(sensor.has_hum);
      const type = String(sensor.type || '').toLowerCase();
      const showHum = type === 'dht22' && hasHum;
      const temp = hasTemp ? Number(sensor.temp_c).toFixed(1) : '--';
      const hum = showHum ? Number(sensor.hum).toFixed(1) : '--';
      const hasData = hasTemp || showHum;
      const statusClass = hasData ? (ok ? 'status-ok' : 'status-err') : 'status-na';
      const statusText = !enabled ? 'Отключен' : (!hasData ? 'Нет данных' : (ok ? 'Норма' : 'Ошибка'));
      const pinNum = Number(sensor.pin);
      const dhtSource = Number.isFinite(pinNum) ? `sens-${pinNum}` : null;
      const sourceLabel = type === 'dht22'
        ? (dhtSource || sensor.addr || sensor.pin || '-')
        : (sensor.addr || sensor.pin || '-');
      return `
        <article class="meteo-tile ${enabled ? '' : 'disabled'}">
          <div class="meteo-visual">
            <span class="socket-chip">#${Number(sensor.id)}</span>
            <svg class="sensor-icon ${showHum ? 'sensor-icon-dht22' : ''} ${ok && hasData ? '' : 'na'}" viewBox="0 0 64 64" aria-hidden="true">
              <path fill="currentColor" d="M32 6c-5.5 0-10 4.5-10 10v19.2c-2.6 2.4-4 5.7-4 9.3 0 7.2 5.8 13 13 13s13-5.8 13-13c0-3.6-1.4-6.9-4-9.3V16c0-5.5-4.5-10-10-10zm6 33.1V16c0-3.3-2.7-6-6-6s-6 2.7-6 6v23.1l-0.9 0.9c-1.8 1.7-2.8 3.9-2.8 6.4 0 4.9 4 9 9 9s9-4 9-9c0-2.5-1-4.8-2.8-6.4l-0.5-0.5z"/>
              <rect x="30" y="20" width="4" height="20" rx="2" fill="currentColor"/>
            </svg>
            <div class="meteo-readout">
              <div class="meteo-temp">${esc(temp)}</div>
              <div class="meteo-unit">&deg;C</div>
              ${showHum ? `
                <div class="meteo-hum-wrap">
                  <svg class="sensor-hum-icon" viewBox="0 0 64 64" aria-hidden="true">
                    <path fill="currentColor" d="M32 6c7 12 16 22 16 34 0 8.8-7.2 16-16 16S16 48.8 16 40c0-12 9-22 16-34z"/>
                  </svg>
                  <div class="meteo-hum">${esc(hum)}</div>
                  <div class="meteo-unit">%</div>
                </div>
              ` : ''}
            </div>
          </div>
          <div class="socket-main">
            <div class="socket-head">
              <div class="socket-name">${esc(sensor.name || `Метео ${Number(sensor.id)}`)}</div>
              <span class="status-dot ${statusClass}"></span>
            </div>
            <div class="socket-meta">${esc(statusText)}</div>
            <div class="socket-meta">Тип: <span class="meta-value">${esc(sensor.type || '-')}</span></div>
            <div class="socket-meta">Источник: <span class="meta-value">${esc(sourceLabel)}</span></div>
          </div>
        </article>
      `;
    }).join('');
  }

  renderLights(detail) {
    const lights = asArray(detail?.controllers?.lights);
    if (!lights.length) {
      this.deviceLightsGrid.innerHTML = this.renderEmptyState('Нет данных по свету');
      return;
    }

    this.deviceLightsGrid.innerHTML = lights.map(light => {
      const on = Boolean(light.state);
      const enabled = Boolean(light.enabled);
      return `
        <article class="light-tile ${enabled ? '' : 'disabled'}" data-light-id="${Number(light.id)}">
          <div class="light-visual ${on ? 'on' : 'off'}">
            <span class="socket-chip">#${Number(light.id)}</span>
            <svg class="light-icon ${on ? 'on' : 'off'}" viewBox="0 0 64 64" aria-hidden="true">
              <path fill="currentColor" d="M32 4c-9.9 0-18 8.1-18 18 0 7.1 4.1 13.2 10 16.2V50c0 2.2 1.8 4 4 4h8c2.2 0 4-1.8 4-4V38.2c5.9-3 10-9.1 10-16.2 0-9.9-8.1-18-18-18zm6 42H26v-4h12v4zm0-8H26v-4h12v4z"/>
            </svg>
          </div>
          <div class="socket-main">
            <div class="socket-head">
              <div class="socket-name">${esc(light.name || `Свет ${Number(light.id)}`)}</div>
              ${onOffDot(on)}
            </div>
            <div class="socket-meta">${enabled ? 'Доступен' : 'Отключен'}</div>
            <div class="light-status-line">
              <span class="status-dot ${on ? 'status-on' : 'status-off'}"></span>
              <span class="status-text">${on ? 'Включена' : 'Выключена'}</span>
            </div>
            <div class="socket-pending-text">Ожидание...</div>
            <div class="socket-actions">
              <button class="ghost btn-sm ${on ? 'btn-off' : 'btn-on'}" data-action="toggle" ${enabled ? '' : 'disabled'}>${on ? 'Статус ВЫКЛ' : 'Статус ВКЛ'}</button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  renderTanks(detail) {
    const tanks = asArray(detail?.controllers?.tanks);
    if (!tanks.length) {
      this.deviceTanksGrid.innerHTML = this.renderEmptyState('Нет данных по бакам');
      return;
    }

    this.deviceTanksGrid.innerHTML = tanks.map(tank => {
      const enabled = Boolean(tank.enabled);
      const powerOn = Boolean(tank.power_on);
      const valveOn = Boolean(tank.valve_on);
      const pumpOn = Boolean(tank.pump_on);
      const alarmOn = Boolean(tank.alarm_on);
      let levelPct = 0;
      let levelClass = 'level-empty';
      let levelText = '0%';
      if (tank.level_full) {
        levelPct = 99;
        levelClass = 'level-full';
        levelText = '99%';
      } else if (tank.level_mid) {
        levelPct = 66;
        levelClass = 'level-mid';
        levelText = '66%';
      } else if (tank.level_low) {
        levelPct = 33;
        levelClass = 'level-low';
        levelText = '33%';
      }


      return `
        <article class="tank-tile ${enabled ? '' : 'disabled'}" data-tank-id="${Number(tank.id)}" data-power-on="${powerOn ? '1' : '0'}">
          <div>
            <div class="tank-visual-control">
              <div class="tank-fill ${levelClass}" style="height:${levelPct}%"></div>
              <div class="tank-label">${levelText}</div>
            </div>
            <div class="status-line">
              <span class="badge">ID ${Number(tank.id)}</span>
              <span class="badge">${powerOn ? 'питание ВКЛ' : 'питание ВЫКЛ'}</span>
            </div>
          </div>
          <div class="socket-main">
            <div class="socket-head">
              <div class="socket-name">${esc(tank.name || `Бак ${Number(tank.id)}`)}</div>
              ${onOffDot(enabled)}
            </div>
            <div class="socket-meta">${enabled ? 'Доступен' : 'Отключен'}</div>
            <div class="tank-status-stack">
              <div class="tank-status-item ${valveOn ? 'is-on' : 'is-off'}">
                <span class="tank-status-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 12h6"></path>
                    <path d="M14 12h6"></path>
                    <path d="M10 8v8"></path>
                    <path d="M10 12h4"></path>
                    <path d="M14 9.5v5"></path>
                  </svg>
                </span>
                <span class="tank-status-label">Клапан</span>
                <span class="tank-status-value">${valveOn ? 'ВКЛ' : 'ВЫКЛ'}</span>
              </div>
              <div class="tank-status-item ${pumpOn ? 'is-on' : 'is-off'}">
                <span class="tank-status-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <circle cx="11" cy="12" r="4.5"></circle>
                    <path d="M15.5 10h2.5a2 2 0 0 1 0 4h-2.5"></path>
                    <path d="M8.5 8.5l3 3.5-4.2 1.1"></path>
                  </svg>
                </span>
                <span class="tank-status-label">Насос</span>
                <span class="tank-status-value">${pumpOn ? 'ВКЛ' : 'ВЫКЛ'}</span>
              </div>
              <div class="tank-status-item ${alarmOn ? 'is-alarm' : 'is-ok'}">
                <span class="tank-status-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M12 4 20 19H4Z"></path>
                    <path d="M12 9v4"></path>
                    <circle cx="12" cy="16.5" r="0.8" class="tank-status-fill"></circle>
                  </svg>
                </span>
                <span class="tank-status-label">Авария</span>
                <span class="tank-status-value">${alarmOn ? 'ДА' : 'НЕТ'}</span>
              </div>
            </div>
            <div class="socket-actions">
              <button class="ghost btn-sm ${powerOn ? 'btn-off' : 'btn-on'}" data-action="power-toggle" ${enabled ? '' : 'disabled'}>${powerOn ? 'Питание ВЫКЛ' : 'Питание ВКЛ'}</button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  renderSecurity(detail) {
    const security = detail?.controllers?.security || null;
    const sensors = asArray(security?.sensors);
    const armed = Boolean(security?.armed);
    const alarm = Boolean(security?.alarm);
    const enabled = Boolean(security?.enabled);
    const gsmOk = Boolean(detail?.system?.gsm?.started || detail?.system?.gsm?.enabled);

    this.deviceSecuritySummary.innerHTML = `
      <span class="pill">Статус: ${armed ? 'На охране' : 'Снято'}</span>
      <span class="pill">Тревога: ${alarm ? 'Да' : 'Нет'}</span>
      <span class="pill">GSM: ${gsmOk ? 'Доступен' : 'Нет связи'}</span>
      <span class="pill">Контур: ${enabled ? 'Включен' : 'Отключен'}</span>
    `;

    this.deviceSecurityActions.querySelectorAll('button[data-action]').forEach(btn => {
      btn.disabled = !enabled;
    });

    if (!sensors.length) {
      this.deviceSecurityGrid.innerHTML = this.renderEmptyState('Нет данных по датчикам');
      return;
    }

    this.deviceSecurityGrid.innerHTML = sensors.map(sensor => {
      const isEnabled = Boolean(sensor.enabled);
      const detect = Boolean(sensor.detect);
      const type = String(sensor.type || '').toLowerCase();
      const name = sensor.name || `Датчик ${Number(sensor.id)}`;
      const silent = Boolean(sensor.silent);
      const iconClass = !isEnabled ? 'off' : (detect ? 'alert' : 'on');
      return `
        <article class="security-tile ${isEnabled ? '' : 'disabled'}">
          <div class="security-visual">
            <span class="socket-chip">#${Number(sensor.id)}</span>
            <svg class="security-icon ${iconClass}" viewBox="0 0 64 64" aria-hidden="true">
              ${type === 'reed'
                ? '<rect x="6" y="18" width="14" height="28" rx="3" fill="currentColor"/><rect x="44" y="18" width="14" height="28" rx="3" fill="currentColor"/><rect x="22" y="30" width="20" height="4" rx="2" fill="currentColor"/>'
                : '<circle cx="32" cy="24" r="6" fill="currentColor"/><path d="M14 48c6-10 12-14 18-14s12 4 18 14" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M8 20c6-6 12-10 18-12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M56 20c-6-6-12-10-18-12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'}
            </svg>
          </div>
          <div class="socket-main">
            <div class="socket-head">
              <div class="socket-name">${esc(name)}</div>
              <span class="status-dot ${!isEnabled ? 'status-off' : (detect ? 'status-err' : 'status-on')}"></span>
            </div>
            <div class="socket-meta">${!isEnabled ? 'Отключен' : (detect ? 'Сработал' : 'Активен')}</div>
            <div class="socket-meta">Тип: <span class="meta-value">${esc(type || '-')}</span></div>
            <div class="socket-meta">Тихий: <span class="meta-value">${silent ? 'Да' : 'Нет'}</span></div>
          </div>
        </article>
      `;
    }).join('');
  }

  renderNetwork(detail) {
    const system = detail?.system || {};
    const wifi = system.wifi || {};
    const gsm = system.gsm || {};

    this.deviceWifiBody.innerHTML = `
      <tr><td>Режим</td><td><strong>${esc(wifi.mode || '-')}</strong></td></tr>
      <tr><td>SSID</td><td><strong>${esc(wifi.ssid || '-')}</strong></td></tr>
      <tr><td>AP SSID</td><td><strong>${esc(wifi.ap_ssid || '-')}</strong></td></tr>
      <tr><td>IP</td><td><strong>${esc(wifi.ip || '-')}</strong></td></tr>
      <tr><td>MAC</td><td><strong>${esc(wifi.mac || '-')}</strong></td></tr>
    `;

    this.deviceGsmBody.innerHTML = `
      <tr><td>Включен</td><td><strong>${gsm.enabled ? 'Да' : 'Нет'}</strong></td></tr>
      <tr><td>Состояние</td><td><strong>${gsm.started ? 'Запущен' : 'Остановлен'}</strong></td></tr>
      <tr><td>IMEI</td><td><strong>${esc(gsm.imei || '-')}</strong></td></tr>
      <tr><td>IMSI</td><td><strong>${esc(gsm.imsi || '-')}</strong></td></tr>
      <tr><td>Оператор</td><td><strong>${esc(gsm.operator || '-')}</strong></td></tr>
      <tr><td>Сигнал</td><td><strong>${esc(gsm.signal || '-')}</strong></td></tr>
      <tr><td>Регистрация</td><td><strong>${esc(gsm.reg_status || '-')}</strong></td></tr>
      <tr><td>Ошибка</td><td><strong>${esc(gsm.last_error || '-')}</strong></td></tr>
      <tr><td>URC</td><td><strong>${esc(gsm.last_urc || '-')}</strong></td></tr>
      <tr><td>Звонок</td><td><strong>${esc(gsm.last_call || '-')}</strong></td></tr>
      <tr><td>USSD запрос</td><td><strong>${esc(gsm.last_ussd || '-')}</strong></td></tr>
      <tr><td>HTTP код</td><td><strong>${esc(gsm.last_http_status ?? '-')}</strong></td></tr>
      <tr><td>HTTP длина</td><td><strong>${esc(gsm.last_http_len ?? '-')}</strong></td></tr>
    `;
  }

  renderThermo(detail) {
    if (!this.deviceThermoGrid) return;
    const list = asArray(detail?.controllers?.thermo);
    if (!list.length) {
      this.deviceThermoGrid.innerHTML = this.renderEmptyState('Нет данных по термо');
      return;
    }
    const modeLabel = (mode) => {
      const m = String(mode || 'off');
      if (m === 'heat_only') return 'нагрев';
      if (m === 'cool_only') return 'охлаждение';
      if (m === 'auto') return 'авто';
      return 'выкл';
    };
    this.deviceThermoGrid.innerHTML = list.map(item => {
      const id = Number(item?.id);
      const enabled = Boolean(item?.enabled);
      const powerOn = Boolean(item?.power_on);
      const heatOn = Boolean(item?.heat_on);
      const coolOn = Boolean(item?.cool_on);
      const mode = String(item?.mode || 'off');
      const target = Number(item?.target_c);
      const sensor = Number(item?.temp_c ?? item?.sensor_temp_c);
      const targetText = Number.isFinite(target) ? target.toFixed(1) : '--';
      const sensorText = Number.isFinite(sensor) ? sensor.toFixed(1) : '--';
      const statusText = heatOn ? 'нагрев' : (coolOn ? 'охлаждение' : 'ожидание');
      const statusClass = heatOn ? 'status-text-heat' : (coolOn ? 'status-text-cool' : 'status-text-idle');
      return `
        <article class="tile ${enabled ? '' : 'disabled'}" data-thermo-id="${id}" data-power-on="${powerOn ? '1' : '0'}" data-mode="${esc(mode)}" data-target="${Number.isFinite(target) ? target.toFixed(1) : ''}">
          <div class="thermo-left">
            <div class="thermo-visual">
              <span class="socket-chip">#${id}</span>
              <span class="temp-pill sensor">Датчик: <span class="temp-value">${esc(sensorText)}</span>&deg;C</span>
              ${thermoStatusVisualSvg(mode, heatOn, coolOn)}
              <span class="temp-pill target">Цель: <span class="temp-value">${esc(targetText)}</span>&deg;C</span>
            </div>
            <div class="status-line">
              <span class="status-dot ${heatOn ? 'status-heat' : (coolOn ? 'status-cool' : 'status-idle')}"></span>
              <span class="status-value ${statusClass}">${statusText}</span>
              <span class="badge">#${id}</span>
            </div>
          </div>
          <div class="socket-main">
            <div class="socket-head">
              <div class="socket-name">${esc(item?.name || `Термо ${id}`)}</div>
              ${onOffDot(enabled)}
            </div>
            <div class="metric-grid">
              <span class="metric-chip ${powerOn ? 'is-on' : 'is-off'}"><span class="metric-label">Питание</span><span class="metric-value">${powerOn ? 'ВКЛ' : 'ВЫКЛ'}</span></span>
              <span class="metric-chip is-running"><span class="metric-label">Режим</span><span class="metric-value">${modeLabel(mode)}</span></span>
              <span class="metric-chip ${heatOn ? 'is-hot' : 'is-off'}"><span class="metric-label">Нагрев</span><span class="metric-value">${heatOn ? 'ВКЛ' : 'ВЫКЛ'}</span></span>
              <span class="metric-chip ${coolOn ? 'is-cool' : 'is-off'}"><span class="metric-label">Охлаждение</span><span class="metric-value">${coolOn ? 'ВКЛ' : 'ВЫКЛ'}</span></span>
            </div>
            <div class="socket-actions action-row">
              <button class="ghost btn-sm ${powerOn ? 'btn-off' : 'btn-on'}" data-action="power-toggle" ${enabled ? '' : 'disabled'}>${powerOn ? 'Питание ВЫКЛ' : 'Питание ВКЛ'}</button>
              <button class="ghost btn-sm" data-action="mode-cycle" ${enabled ? '' : 'disabled'}>Режим</button>
              <button class="ghost btn-sm" data-action="target-down" ${enabled ? '' : 'disabled'}>-0.5 &deg;C</button>
              <button class="ghost btn-sm" data-action="target-up" ${enabled ? '' : 'disabled'}>+0.5 &deg;C</button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  renderSeptic(detail) {
    if (!this.deviceSepticGrid) return;
    const list = asArray(detail?.controllers?.septic);
    if (!list.length) {
      this.deviceSepticGrid.innerHTML = this.renderEmptyState('Нет данных по септику');
      return;
    }
    this.deviceSepticGrid.innerHTML = list.map(item => {
      const id = Number(item?.id);
      const enabled = Boolean(item?.enabled);
      const monitor = Boolean(item?.monitoring_on ?? item?.monitor_on);
      const warning = Boolean(item?.warning);
      const alarm = Boolean(item?.alarm);
      const levelClass = alarm ? 'water-alarm' : (warning ? 'water-warn' : 'water-low');
      const levelText = alarm ? 'АВАРИЯ' : (warning ? 'ВНИМАНИЕ' : 'НОРМА');
      return `
        <article class="tile ${enabled ? '' : 'disabled'}" data-septic-id="${id}" data-monitor="${monitor ? '1' : '0'}">
          <div class="thermo-left">
            <div class="septic-visual">
              <span class="socket-chip">#${id}</span>
              <div class="liquid ${levelClass}" style="height:${alarm ? '82%' : (warning ? '55%' : '28%')};"></div>
              <span class="level-label">${levelText}</span>
              <svg class="icon ${alarm ? 'active' : 'inactive'}" viewBox="0 0 64 64" aria-hidden="true">
                <rect x="12" y="10" width="40" height="44" rx="6"></rect>
                <path d="M20 30h24M20 38h24"/>
              </svg>
            </div>
            <div class="status-line">
              <span class="status-dot ${alarm ? 'status-err' : (warning ? 'status-cool' : 'status-on')}"></span>
              <span class="status-value">${alarm ? 'Тревога' : (warning ? 'Предупреждение' : 'Норма')}</span>
              <span class="badge">#${id}</span>
            </div>
          </div>
          <div class="socket-main">
            <div class="socket-head">
              <div class="socket-name">${esc(item?.name || `Септик ${id}`)}</div>
              ${onOffDot(enabled)}
            </div>
            <div class="mini-state-grid">
              <div class="mini-state-item ${monitor ? 'is-on' : 'is-off'}">
                <span class="mini-state-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M7 12h10"></path>
                    <path d="M12 7v10"></path>
                    <circle cx="12" cy="12" r="7"></circle>
                  </svg>
                </span>
                <span class="mini-state-label">Мониторинг</span>
                <span class="mini-state-value">${monitor ? 'ВКЛ' : 'ВЫКЛ'}</span>
              </div>
              <div class="mini-state-item ${warning ? 'is-warn' : 'is-off'}">
                <span class="mini-state-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M12 4 20 19H4Z"></path>
                    <path d="M12 9v4"></path>
                    <circle cx="12" cy="16.5" r="0.8" class="mini-state-fill"></circle>
                  </svg>
                </span>
                <span class="mini-state-label">Предупреждение</span>
                <span class="mini-state-value">${warning ? 'ВКЛ' : 'ВЫКЛ'}</span>
              </div>
              <div class="mini-state-item ${alarm ? 'is-alarm' : 'is-ok'}">
                <span class="mini-state-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M12 4 20 19H4Z"></path>
                    <path d="M12 9v4"></path>
                    <circle cx="12" cy="16.5" r="0.8" class="mini-state-fill"></circle>
                  </svg>
                </span>
                <span class="mini-state-label">Авария</span>
                <span class="mini-state-value">${alarm ? 'ВКЛ' : 'ВЫКЛ'}</span>
              </div>
            </div>
            <div class="socket-actions action-row">
              <button class="ghost btn-sm ${monitor ? 'btn-off' : 'btn-on'}" data-action="monitor-toggle" ${enabled ? '' : 'disabled'}>${monitor ? 'Мониторинг ВЫКЛ' : 'Мониторинг ВКЛ'}</button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  renderWatering(detail) {
    if (!this.deviceWateringGrid) return;
    const list = asArray(detail?.controllers?.watering);
    if (!list.length) {
      this.deviceWateringGrid.innerHTML = this.renderEmptyState('Нет данных по поливу');
      return;
    }
    this.deviceWateringGrid.innerHTML = list.map(item => {
      const id = Number(item?.id);
      const enabled = Boolean(item?.enabled);
      const active = Boolean(item?.active ?? item?.status);
      const paused = Boolean(item?.paused);
      const resume = Boolean(item?.resume);
      const left = Number(item?.left_min ?? item?.left ?? item?.minutes_left);
      const leftText = Number.isFinite(left) && left >= 0 ? `${Math.round(left)} мин` : '-';
      return `
        <article class="tile watering-item ${enabled ? '' : 'disabled'}" data-watering-id="${id}" data-status="${active ? '1' : '0'}" data-active="${active ? '1' : '0'}">
          <div class="thermo-left">
            <div class="watering-visual">
              <span class="socket-chip">#${id}</span>
              <svg class="watering-icon" viewBox="0 0 64 64" aria-hidden="true">
                <path d="M8 34h20v10h8V34h8c6 0 12 5 12 12v2"/>
                <path d="M56 52c0 4-3 6-6 6s-6-2-6-6c0-4 6-10 6-10s6 6 6 10z"/>
              </svg>
              <span class="level-label">${active ? 'РАБОТА' : 'ПРОСТОЙ'}</span>
            </div>
            <div class="status-line">
              <span class="status-dot ${active ? 'status-on' : 'status-idle'}"></span>
              <span class="status-value">${active ? 'Активен' : 'Остановлен'}</span>
              <span class="badge">#${id}</span>
            </div>
          </div>
          <div class="socket-main">
            <div class="socket-head">
              <div class="socket-name">${esc(item?.name || `Полив ${id}`)}</div>
              ${onOffDot(enabled)}
            </div>
            <div class="metric-grid">
              <span class="metric-chip ${active ? 'is-on' : 'is-off'}"><span class="metric-label">Статус</span><span class="metric-value">${active ? 'ВКЛ' : 'ВЫКЛ'}</span></span>
              <span class="metric-chip ${paused ? 'is-warn' : 'is-off'}"><span class="metric-label">Пауза</span><span class="metric-value">${paused ? 'ДА' : 'НЕТ'}</span></span>
              <span class="metric-chip ${resume ? 'is-running' : 'is-off'}"><span class="metric-label">Возобновление</span><span class="metric-value">${resume ? 'ВКЛ' : 'ВЫКЛ'}</span></span>
              <span class="metric-chip is-off"><span class="metric-label">Осталось</span><span class="metric-value">${esc(leftText)}</span></span>
            </div>
            <div class="socket-actions action-row">
              <button class="ghost btn-sm ${active ? 'btn-off' : 'btn-on'}" data-action="status-toggle" ${enabled ? '' : 'disabled'}>${active ? 'Статус ВЫКЛ' : 'Статус ВКЛ'}</button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  renderRing(detail) {
    if (!this.deviceRingWrap) return;
    const ring = detail?.controllers?.ring || null;
    if (!ring || typeof ring !== 'object') {
      this.deviceRingWrap.innerHTML = this.renderEmptyState('Нет данных по звонку');
      return;
    }
    const enabled = Boolean(ring.enabled);
    const relayOn = Boolean(ring.relay_on ?? ring.hold_on);
    const buttonOn = Boolean(ring.button_on ?? ring.button);
    this.deviceRingWrap.innerHTML = `
      <article class="ring-card ${enabled ? '' : 'disabled'}">
        <div class="ring-head">
          <span class="pill">Статус: ${enabled ? 'доступен' : 'отключен'}</span>
        </div>
        <div class="state-indicators">
          <span class="state-item"><span class="state-dot ${relayOn ? 'net-on' : ''}"></span> Реле: <strong>${relayOn ? 'ВКЛ' : 'ВЫКЛ'}</strong></span>
          <span class="state-item"><span class="state-dot ${buttonOn ? 'net-on' : ''}"></span> Кнопка: <strong>${buttonOn ? 'ВКЛ' : 'ВЫКЛ'}</strong></span>
        </div>
        <div class="socket-actions">
          <button class="ghost btn-sm ${relayOn ? 'btn-off' : 'btn-on'}" data-action="ring-hold" ${enabled ? '' : 'disabled'}>${relayOn ? 'Удержание ВКЛ' : 'Удержание ВЫКЛ'}</button>
        </div>
      </article>
    `;
  }

  renderAvr(detail) {
    if (!this.deviceAvrWrap) return;
    const avr = detail?.controllers?.avr || null;
    if (!avr || typeof avr !== 'object') {
      this.deviceAvrWrap.innerHTML = this.renderEmptyState('Нет данных по АВР');
      return;
    }
    const enabled = Boolean(avr.enabled);
    const autoMode = Boolean(avr.auto_mode ?? avr.auto);
    const active = String(avr.active_source || avr.source || '-');
    const source1 = String(avr.source1 || 'основной');
    const source2 = String(avr.source2 || 'резерв');
    const fault = String(avr.fault || 'none');
    const faultActive = fault !== 'none' && fault !== 'ok' && fault !== '-';
    this.deviceAvrWrap.innerHTML = `
      <article class="avr-card ${enabled ? '' : 'disabled'}" data-auto-mode="${autoMode ? '1' : '0'}">
        <div class="mini-state-grid avr-top-grid">
          <div class="mini-state-item ${autoMode ? 'is-on' : 'is-off'}">
            <span class="mini-state-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3v4"></path>
                <path d="M12 17v4"></path>
                <path d="M4.9 4.9l2.8 2.8"></path>
                <path d="M16.3 16.3l2.8 2.8"></path>
                <path d="M3 12h4"></path>
                <path d="M17 12h4"></path>
                <circle cx="12" cy="12" r="4"></circle>
              </svg>
            </span>
            <span class="mini-state-label">Авто</span>
            <span class="mini-state-value">${autoMode ? 'ВКЛ' : 'ВЫКЛ'}</span>
          </div>
          <div class="mini-state-item is-running">
            <span class="mini-state-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 12h6"></path>
                <path d="M14 12h6"></path>
                <path d="M10 8v8"></path>
                <path d="M14 8v8"></path>
                <path d="M10 12h4"></path>
              </svg>
            </span>
            <span class="mini-state-label">Источник</span>
            <span class="mini-state-value">${esc(active)}</span>
          </div>
          <div class="mini-state-item ${faultActive ? 'is-alarm' : 'is-ok'}">
            <span class="mini-state-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 4 20 19H4Z"></path>
                <path d="M12 9v4"></path>
                <circle cx="12" cy="16.5" r="0.8" class="mini-state-fill"></circle>
              </svg>
            </span>
            <span class="mini-state-label">Авария</span>
            <span class="mini-state-value">${esc(fault)}</span>
          </div>
        </div>
        <div class="group-title">Управление</div>
        <div class="socket-actions">
          <button class="ghost btn-sm ${autoMode ? 'btn-off' : 'btn-on'}" data-action="auto-toggle" ${enabled ? '' : 'disabled'}>${autoMode ? 'Авто ВЫКЛ' : 'Авто ВКЛ'}</button>
          <button class="ghost btn-sm" data-action="source" data-source="${esc(source1)}" ${enabled ? '' : 'disabled'}>${esc(source1)}</button>
          <button class="ghost btn-sm" data-action="source" data-source="${esc(source2)}" ${enabled ? '' : 'disabled'}>${esc(source2)}</button>
          <button class="ghost btn-sm" data-action="clear-fault" ${enabled ? '' : 'disabled'}>Сброс аварии</button>
        </div>
      </article>
    `;
  }

  renderLeak(detail) {
    if (!this.deviceLeakGrid) return;
    const list = asArray(detail?.controllers?.leak);
    if (!list.length) {
      this.deviceLeakGrid.innerHTML = this.renderEmptyState('Нет данных по протечкам');
      return;
    }
    this.deviceLeakGrid.innerHTML = list.map(item => {
      const id = Number(item?.id);
      const enabled = Boolean(item?.enabled);
      const powerOn = Boolean(item?.power_on);
      const wet = Boolean(item?.wet);
      const alarmLatched = Boolean(item?.alarm_latched ?? item?.alarm);
      const alert = wet || alarmLatched;
      return `
        <article class="tile ${enabled ? '' : 'disabled'} ${alert ? 'alert' : ''}" data-leak-id="${id}" data-power-on="${powerOn ? '1' : '0'}">
          <div class="tile-left">
            <svg class="security-icon leak-icon ${alert ? 'alert' : (powerOn ? 'on' : 'off')}" viewBox="0 0 64 64" aria-hidden="true">
              <path d="M32 8c7 12 16 20 16 32 0 8.8-7.2 16-16 16s-16-7.2-16-16c0-12 9-20 16-32z"></path>
              <path d="M24 42c2.5 2.5 5 3.5 8 3.5s5.5-1 8-3.5"></path>
            </svg>
            <span class="tile-id">#${id}</span>
            ${onOffDot(enabled)}
          </div>
          <div class="tile-grid">
            <span class="metric-chip ${powerOn ? 'is-on' : 'is-off'}"><span class="metric-label">Питание</span><span class="metric-value">${powerOn ? 'ВКЛ' : 'ВЫКЛ'}</span></span>
            <span class="metric-chip ${wet ? 'is-alarm' : 'is-off'}"><span class="metric-label">Влага</span><span class="metric-value">${wet ? 'ДА' : 'НЕТ'}</span></span>
            <span class="metric-chip ${alarmLatched ? 'is-warn' : 'is-off'}"><span class="metric-label">Фиксация</span><span class="metric-value">${alarmLatched ? 'ДА' : 'НЕТ'}</span></span>
          </div>
          <div class="socket-actions">
            <button class="ghost btn-sm ${powerOn ? 'btn-off' : 'btn-on'}" data-action="power-toggle" ${enabled ? '' : 'disabled'}>${powerOn ? 'Питание ВЫКЛ' : 'Питание ВКЛ'}</button>
            <button class="ghost btn-sm" data-action="ack" ${enabled ? '' : 'disabled'}>Сброс</button>
          </div>
        </article>
      `;
    }).join('');
  }

  renderAdminDevices(devices, objects, onRotate, onDelete, onMoveObject) {
    this.adminDevices.innerHTML = '';
    if (!devices.length) {
      this.adminDevices.textContent = 'Нет устройств';
      return;
    }
    for (const device of devices) {
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.innerHTML = `
        <div class="admin-main">
          <div class="admin-device-head">
            <svg class="admin-device-icon" viewBox="0 0 64 64" aria-hidden="true">
              <rect x="8" y="12" width="48" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="4"/>
              <rect x="24" y="24" width="16" height="16" rx="2" fill="currentColor"/>
              <circle cx="18" cy="22" r="2.5" fill="currentColor"/>
              <circle cx="46" cy="22" r="2.5" fill="currentColor"/>
              <circle cx="18" cy="42" r="2.5" fill="currentColor"/>
              <circle cx="46" cy="42" r="2.5" fill="currentColor"/>
              <path d="M6 20h6M6 28h6M6 36h6M6 44h6M52 20h6M52 28h6M52 36h6M52 44h6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
            </svg>
            <div><strong>${device.name || 'Без имени'}</strong> (#${device.device_id})</div>
          </div>
          <div class="muted">${device.object_name} · ${device.online ? 'онлайн' : 'оффлайн'}</div>
          <div class="key">API-ключ: ${device.api_key}</div>
        </div>
      `;
      const actions = document.createElement('div');
      actions.className = 'admin-actions';
      const objectSelect = document.createElement('select');
      objectSelect.className = 'admin-object-select';
      for (const objectName of objects) {
        const opt = document.createElement('option');
        opt.value = objectName;
        opt.textContent = objectName;
        objectSelect.appendChild(opt);
      }
      const canMove = objects.length > 0;
      objectSelect.disabled = !canMove;
      if (objects.includes(device.object_name)) {
        objectSelect.value = device.object_name;
      }
      objectSelect.addEventListener('change', () => onMoveObject(device, objectSelect.value));
      const rotate = document.createElement('button');
      rotate.className = 'ghost';
      rotate.textContent = 'Сменить ключ';
      rotate.addEventListener('click', () => onRotate(device));
      const del = document.createElement('button');
      del.className = 'ghost danger';
      del.textContent = 'Удалить';
      del.addEventListener('click', () => onDelete(device));
      actions.appendChild(objectSelect);
      actions.appendChild(rotate);
      actions.appendChild(del);
      row.appendChild(actions);
      this.adminDevices.appendChild(row);
    }
  }

  renderAdminObjects(objects, onDelete, onRename, onIconChange) {
    this.adminObjects.innerHTML = '';
    if (!objects.length) {
      this.adminObjects.textContent = 'Нет объектов';
      return;
    }
    for (const raw of objects) {
      const objectItem = normalizeObjectItem(raw);
      const objectName = objectItem.name;
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.innerHTML = `
        <div class="admin-main">
          <div class="admin-object-head">
            <span class="admin-object-preview">${objectIconSvg(objectItem.icon)}</span>
            <strong>${esc(objectName)}</strong>
          </div>
        </div>
      `;
      const actions = document.createElement('div');
      actions.className = 'admin-actions';
      const iconSelect = document.createElement('select');
      iconSelect.className = 'admin-object-select';
      for (const option of OBJECT_ICON_OPTIONS) {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        iconSelect.appendChild(opt);
      }
      iconSelect.value = OBJECT_ICON_OPTIONS.some(row => row.value === objectItem.icon) ? objectItem.icon : 'house';
      iconSelect.addEventListener('change', () => onIconChange(objectName, iconSelect.value));
      const rename = document.createElement('button');
      rename.className = 'ghost';
      rename.textContent = 'Переименовать';
      rename.addEventListener('click', () => onRename(objectName));
      const del = document.createElement('button');
      del.className = 'ghost danger';
      del.textContent = 'Удалить';
      del.addEventListener('click', () => onDelete(objectName));
      actions.appendChild(iconSelect);
      actions.appendChild(rename);
      actions.appendChild(del);
      row.appendChild(actions);
      this.adminObjects.appendChild(row);
    }
  }
}

