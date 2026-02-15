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
    this.deviceNetworkView = document.getElementById('deviceNetworkView');

    this.mainMenu = document.getElementById('mainMenu');
    this.menuObjectsBtn = document.getElementById('menuObjects');
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

    this.backToObjects = document.getElementById('backToObjects');
    this.backToDevices = document.getElementById('backToDevices');
    this.backToDevicesFromControllers = document.getElementById('backToDevicesFromControllers');
    this.backToControllersFromSockets = document.getElementById('backToControllersFromSockets');
    this.backToControllersFromLights = document.getElementById('backToControllersFromLights');
    this.backToControllersFromTanks = document.getElementById('backToControllersFromTanks');
    this.backToControllersFromSecurity = document.getElementById('backToControllersFromSecurity');
    this.backToControllersFromMeteo = document.getElementById('backToControllersFromMeteo');
    this.backToDevicesFromNetwork = document.getElementById('backToDevicesFromNetwork');
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

  setLightsNotice(text = '') {
    this.deviceLightsNotice.textContent = text;
  }

  setTanksNotice(text = '') {
    this.deviceTanksNotice.textContent = text;
  }

  setSecurityNotice(text = '') {
    this.deviceSecurityNotice.textContent = text;
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
    this.deviceNetworkView.classList.toggle('hidden', view !== 'deviceNetwork');

    const inAuthViews = view !== 'login';
    this.mainMenu.classList.toggle('hidden', !inAuthViews);
    this.menuObjectsBtn.classList.toggle('active', view !== 'login' && view !== 'settings');
    this.menuSettingsBtn.classList.toggle('active', view === 'settings');

    const inDevicePages = view === 'device' || view === 'deviceControllers' || view === 'deviceSockets' || view === 'deviceLights' || view === 'deviceTanks' || view === 'deviceSecurity' || view === 'deviceMeteo' || view === 'deviceNetwork';
    this.topMenu.classList.toggle('hidden', !inDevicePages);
    this.menuStatusBtn.classList.toggle('active', view === 'device');
    this.menuControllersBtn.classList.toggle('active', view === 'deviceControllers' || view === 'deviceSockets' || view === 'deviceLights' || view === 'deviceTanks' || view === 'deviceSecurity' || view === 'deviceMeteo');
    this.menuNetworkBtn.classList.toggle('active', view === 'deviceNetwork');
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

    this.deviceStatusBody.innerHTML = `
      <tr><td>Имя устройства</td><td><strong>${esc(detail.name || '-')}</strong></td></tr>
      <tr><td>Дата</td><td><strong>${esc(rtc.date || '-')}</strong></td></tr>
      <tr><td>Время</td><td><strong>${esc(rtc.time || '-')}</strong></td></tr>
      <tr><td>RTC температура</td><td><strong>${esc(rtc.temp_c ?? '-')}</strong></td></tr>
      <tr><td>Температура платы</td><td><strong>${esc(plc.board_temp ?? '-')}</strong></td></tr>
      <tr><td>CPU</td><td><strong>${esc(plc.cpu_temp ?? '-')}</strong></td></tr>
      <tr><td>Вентилятор</td><td>${onOffDot(Boolean(fan.fan_on))}</td></tr>
      <tr><td>Статус</td><td>${onOffDot(Boolean(detail.online))}</td></tr>
    `;

    const cards = summarizeControllers(detail.controllers);
    this.deviceControllersGrid.innerHTML = cards
      .map(card => `
        <div class="ctrl-card" data-controller="${esc(card.key)}">
          <div class="ctrl-head">
            ${onOffDot(card.online)}
            <span>${esc(card.title)}</span>
          </div>
          <div class="ctrl-value">${esc(card.status)}</div>
        </div>
      `)
      .join('');

  }

  renderSockets(detail) {
    const sockets = asArray(detail?.controllers?.sockets);
    if (!sockets.length) {
      this.deviceSocketsGrid.innerHTML = '<div class="muted">Нет данных по розеткам</div>';
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
            <div class="socket-meta">${enabled ? 'Включена' : 'Отключена'}</div>
            <div class="socket-pending-text">Ожидание...</div>
            <div class="socket-actions">
              <button class="ghost btn-sm" data-action="toggle" ${enabled ? '' : 'disabled'}>Переключить</button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  renderMeteo(detail) {
    const meteo = asArray(detail?.controllers?.meteo);
    if (!meteo.length) {
      this.deviceMeteoGrid.innerHTML = '<div class="muted">Нет данных по метео</div>';
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
      const statusText = !enabled ? 'Отключен' : (!hasData ? 'Нет данных' : (ok ? 'OK' : 'Ошибка'));
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
              <div class="meteo-unit">C</div>
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
      this.deviceLightsGrid.innerHTML = '<div class="muted">Нет данных по свету</div>';
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
              <button class="ghost btn-sm" data-action="toggle" ${enabled ? '' : 'disabled'}>Переключить</button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  renderTanks(detail) {
    const tanks = asArray(detail?.controllers?.tanks);
    if (!tanks.length) {
      this.deviceTanksGrid.innerHTML = '<div class="muted">Нет данных по бакам</div>';
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

      const lowPort = Number(tank.low);
      const midPort = Number(tank.mid);
      const fullPort = Number(tank.full);
      const fmtPort = (prefix, value) => Number.isFinite(value) && value >= 0 ? `${prefix}${value}` : '-';

      return `
        <article class="tank-tile ${enabled ? '' : 'disabled'}" data-tank-id="${Number(tank.id)}" data-power-on="${powerOn ? '1' : '0'}">
          <div>
            <div class="tank-visual-control">
              <div class="tank-fill ${levelClass}" style="height:${levelPct}%"></div>
              <div class="tank-label">${levelText}</div>
            </div>
            <div class="status-line">
              <span class="badge">ID ${Number(tank.id)}</span>
              <span class="badge">${powerOn ? 'питание on' : 'питание off'}</span>
            </div>
          </div>
          <div class="socket-main">
            <div class="socket-head">
              <div class="socket-name">${esc(tank.name || `Бак ${Number(tank.id)}`)}</div>
              ${onOffDot(enabled)}
            </div>
            <div class="socket-meta">${enabled ? 'Доступен' : 'Отключен'}</div>
            <div class="status-line">
              <span class="status-dot ${valveOn ? 'status-on' : 'status-off'}"></span><span>Клапан</span>
              <span class="status-dot ${pumpOn ? 'status-on' : 'status-off'}"></span><span>Насос</span>
              <span class="status-dot ${alarmOn ? 'status-err' : 'status-off'}"></span><span>Авария</span>
            </div>
            <div class="socket-meta">Низкий: <span class="meta-value">${esc(fmtPort('in', lowPort))}</span> · Средний: <span class="meta-value">${esc(fmtPort('in', midPort))}</span> · Полный: <span class="meta-value">${esc(fmtPort('in', fullPort))}</span></div>
            <div class="socket-actions">
              <button class="ghost btn-sm" data-action="power-toggle" ${enabled ? '' : 'disabled'}>${powerOn ? 'Питание OFF' : 'Питание ON'}</button>
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
      <span class="pill">GSM: ${gsmOk ? 'OK' : 'Нет'}</span>
      <span class="pill">Контур: ${enabled ? 'Включен' : 'Отключен'}</span>
    `;

    this.deviceSecurityActions.querySelectorAll('button[data-action]').forEach(btn => {
      btn.disabled = !enabled;
    });

    if (!sensors.length) {
      this.deviceSecurityGrid.innerHTML = '<div class="muted">Нет данных по датчикам</div>';
      return;
    }

    this.deviceSecurityGrid.innerHTML = sensors.map(sensor => {
      const isEnabled = Boolean(sensor.enabled);
      const detect = Boolean(sensor.detect);
      const type = String(sensor.type || '').toLowerCase();
      const name = sensor.name || `Датчик ${Number(sensor.id)}`;
      const port = Number(sensor.port);
      const portLabel = Number.isFinite(port) && port >= 0 ? `in${port}` : '-';
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
            <div class="socket-meta">Порт: <span class="meta-value">${esc(portLabel)}</span></div>
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
      <tr><td>USSD</td><td><strong>${esc(gsm.last_ussd || '-')}</strong></td></tr>
      <tr><td>HTTP status</td><td><strong>${esc(gsm.last_http_status ?? '-')}</strong></td></tr>
      <tr><td>HTTP len</td><td><strong>${esc(gsm.last_http_len ?? '-')}</strong></td></tr>
    `;
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
          <div class="muted">${device.object_name} · ${device.online ? 'online' : 'offline'}</div>
          <div class="key">api_key: ${device.api_key}</div>
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
