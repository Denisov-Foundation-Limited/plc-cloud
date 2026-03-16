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
import { api } from './api.js';
import { state } from './state.js';
import { Ui } from './ui.js';
import { WebSocketClient } from './ws.js';

const ui = new Ui({ state });
const ws = new WebSocketClient({ state, ui });
const DEVICE_POLL_INTERVAL_MS = 3000;
let devicePollTimer = null;
const lightPendingOps = new Map();
const LIGHT_POLL_INTERVAL_MS = 700;
const LIGHT_POLL_MAX_ATTEMPTS = 4;
const LIGHT_POLL_MIN_SEND_GAP_MS = 550;
const UI_PENDING_MS = 1400;
let devicesRequestSeq = 0;
let lastLightPollSentMs = 0;
const TARGET_STORE_KEY = 'plc_cloud_target_by_device';
const tilePendingTimers = new WeakMap();
const buttonPendingTimers = new WeakMap();

function setActionButtonsDisabled(root, disabled) {
  if (!root) return;
  root.querySelectorAll('[data-action]').forEach((btn) => {
    if (btn.closest('.disabled')) return;
    btn.disabled = Boolean(disabled);
  });
}

function clearTilePending(root) {
  if (!root) return;
  const timer = tilePendingTimers.get(root);
  if (timer) {
    clearTimeout(timer);
    tilePendingTimers.delete(root);
  }
  root.classList.remove('pending');
  setActionButtonsDisabled(root, false);
}

function markTilePending(root, ms = UI_PENDING_MS) {
  if (!root || root.classList.contains('disabled')) return;
  clearTilePending(root);
  setActionButtonsDisabled(root, true);
  const timer = setTimeout(() => {
    clearTilePending(root);
  }, Math.max(300, Number(ms) || UI_PENDING_MS));
  tilePendingTimers.set(root, timer);
}

function markButtonPending(btn, ms = UI_PENDING_MS) {
  if (!btn || btn.disabled) return;
  const timer = buttonPendingTimers.get(btn);
  if (timer) clearTimeout(timer);
  btn.disabled = true;
  buttonPendingTimers.set(btn, setTimeout(() => {
    if (!btn.closest('.disabled')) btn.disabled = false;
    buttonPendingTimers.delete(btn);
  }, Math.max(300, Number(ms) || UI_PENDING_MS)));
}

function installPressedState() {
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    btn.classList.add('is-pressed');
  });
  const clearPressed = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    btn.classList.remove('is-pressed');
  };
  document.addEventListener('pointerup', clearPressed);
  document.addEventListener('pointercancel', clearPressed);
  document.addEventListener('pointerleave', clearPressed, true);
}

installPressedState();

function loadTargets() {
  try {
    const raw = window.localStorage.getItem(TARGET_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

function saveTargets() {
  try {
    window.localStorage.setItem(TARGET_STORE_KEY, JSON.stringify(state.targetByDevice || {}));
  } catch (err) {
    // ignore storage errors
  }
}

function setCurrentTarget(unit, nodeId = null) {
  let nextUnit = unit === 'stack' ? 'stack' : 'local';
  let nextNodeId = nextUnit === 'stack' ? Number(nodeId) : null;
  if (nextUnit === 'stack' && (!Number.isFinite(nextNodeId) || nextNodeId <= 0)) {
    nextUnit = 'local';
    nextNodeId = null;
  }
  const changed = state.currentUnit !== nextUnit || Number(state.currentNodeId || 0) !== Number(nextNodeId || 0);
  state.currentUnit = nextUnit;
  state.currentNodeId = nextNodeId;
  if (!state.currentDevice) return;
  const key = String(Number(state.currentDevice.device_id));
  state.targetByDevice[key] = state.currentUnit === 'stack' && state.currentNodeId
    ? { unit: 'stack', node_id: Number(state.currentNodeId) }
    : { unit: 'local', node_id: null };
  saveTargets();
  return changed;
}

function getTargetOptions(detail) {
  const nodes = Array.isArray(detail?.stack?.nodes) ? detail.stack.nodes.filter(n => Number(n?.node_id) > 0) : [];
  const deviceId = Number(state.currentDevice?.device_id) || Number(detail?.device_id) || 0;
  const masterOnline = typeof detail?.online === 'boolean'
    ? Boolean(detail.online)
    : (typeof state.currentDeviceData?.online === 'boolean' ? Boolean(state.currentDeviceData.online) : null);
  const options = [{
    unit: 'local',
    node_id: null,
    role: 'master',
    online: masterOnline,
    label: `Мастер: ${state.currentDevice?.name || detail?.name || '#' + deviceId}`
  }];
  for (const node of nodes) {
    const nodeId = Number(node.node_id);
    options.push({
      unit: 'stack',
      node_id: nodeId,
      role: 'slave',
      online: typeof node?.online === 'boolean' ? Boolean(node.online) : null,
      label: `Слейв: ${node.name || `Stack #${nodeId}`} (#${nodeId})`
    });
  }
  return options;
}

function renderTargetPicker(detail) {
  const options = getTargetOptions(detail);
  if (state.currentUnit === 'stack' && state.currentNodeId) {
    const hasStackNodes = Array.isArray(detail?.stack?.nodes);
    // Do not fallback to local until we actually have stack nodes from device.
    if (hasStackNodes) {
      const exists = options.some(o => o.unit === 'stack' && Number(o.node_id) === Number(state.currentNodeId));
      if (!exists) {
        setCurrentTarget('local', null);
      }
    }
  }
  ui.renderTargetPicker(options, state.currentUnit, state.currentNodeId);
}

function expandDevicesWithVirtual(devices = []) {
  const result = [];
  for (const device of Array.isArray(devices) ? devices : []) {
    const master = {
      ...device,
      virtual: false
    };
    result.push(master);

    const nodes = Array.isArray(device?.stack?.nodes) ? device.stack.nodes : [];
    for (const node of nodes) {
      const nodeId = Number(node?.node_id);
      if (!Number.isFinite(nodeId) || nodeId <= 0) continue;
      result.push({
        virtual: true,
        master_device_id: Number(device.device_id),
        master_name: device.name || `#${Number(device.device_id)}`,
        node_id: nodeId,
        online: typeof node?.online === 'boolean' ? Boolean(node.online) : true,
        name: node?.name || `Stack #${nodeId}`,
        device_id: `${Number(device.device_id)}:${nodeId}`,
        object_name: device.object_name
      });
    }
  }
  return result;
}

async function loadObjects() {
  const data = await api('/api/objects');
  state.objects = Array.isArray(data.objects) ? data.objects : [];
  ui.renderObjects(selectObject);
  ui.renderAdminObjects(
    state.objects,
    async (objectName) => {
      try {
        await api(`/api/admin/objects/${encodeURIComponent(objectName)}`, { method: 'DELETE' });
        if (state.currentObject === objectName) {
          state.currentObject = null;
          state.devices = [];
        }
        await refreshObjects();
        ui.setStatus(`Объект "${objectName}" удален`);
      } catch (err) {
        if (err?.message === 'object_has_devices') {
          ui.setStatus('Нельзя удалить объект: к нему привязаны устройства', false);
          return;
        }
        ui.setStatus('Не удалось удалить объект', false);
      }
    },
    async (objectName) => {
      const nextName = window.prompt('Новое название объекта', objectName);
      if (nextName === null) return;
      const trimmed = String(nextName).trim();
      if (!trimmed) {
        ui.setStatus('Введите новое название объекта', false);
        return;
      }
      try {
        await api(`/api/admin/objects/${encodeURIComponent(objectName)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed })
        });
        if (state.currentObject === objectName) {
          state.currentObject = trimmed;
        }
        await refreshObjects();
        ui.setStatus(`Объект "${objectName}" переименован в "${trimmed}"`);
      } catch (err) {
        if (err?.message === 'object_exists') {
          ui.setStatus('Такой объект уже существует', false);
          return;
        }
        if (err?.message === 'object_name_same') {
          ui.setStatus('Новое имя совпадает с текущим', false);
          return;
        }
        ui.setStatus('Не удалось переименовать объект', false);
      }
    },
    async (objectName, icon) => {
      try {
        await api(`/api/admin/objects/${encodeURIComponent(objectName)}/icon`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ icon })
        });
        await refreshObjects();
        ui.setStatus(`Иконка объекта "${objectName}" обновлена`);
      } catch (err) {
        ui.setStatus('Не удалось обновить иконку объекта', false);
      }
    }
  );
}

async function refreshObjects() {
  await loadObjects();
}

async function loadAdminDevices() {
  const data = await api('/api/admin/devices');
  ui.renderAdminDevices(
    data.devices || [],
    (state.objects || []).map(row => typeof row === 'string' ? row : row.name).filter(Boolean),
    async (device) => {
      await api(`/api/admin/devices/${device.device_id}/rotate_key`, { method: 'POST' });
      await loadAdminDevices();
    },
    async (device) => {
      await api(`/api/admin/devices/${device.device_id}`, { method: 'DELETE' });
      await refreshObjects();
      await loadAdminDevices();
    },
    async (device, objectName) => {
      const nextObjectName = String(objectName || '').trim();
      if (!nextObjectName || nextObjectName === device.object_name) return;
      try {
        await api(`/api/admin/devices/${device.device_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ object_name: nextObjectName })
        });
        await refreshObjects();
        await loadAdminDevices();
        if (state.currentObject) {
          requestDevices(state.currentObject);
        }
        ui.setStatus(`Устройство #${device.device_id} перенесено в "${nextObjectName}"`);
      } catch (err) {
        ui.setStatus('Не удалось перенести устройство в другой объект', false);
      }
    }
  );
}

async function loadAdminUsers() {
  const data = await api('/api/admin/users');
  ui.renderAdminUsers(
    data.users || [],
    async (user, plcUsername) => {
      try {
        await api(`/api/admin/users/${encodeURIComponent(user.username)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plc_username: String(plcUsername || '').trim() })
        });
        await loadAdminUsers();
        ui.setStatus(`Пользователь "${user.username}" обновлен`);
      } catch (err) {
        ui.setStatus('Не удалось сохранить PLC username', false);
      }
    },
    async (user) => {
      try {
        await api(`/api/admin/users/${encodeURIComponent(user.username)}`, { method: 'DELETE' });
        await loadAdminUsers();
        ui.setStatus(`Пользователь "${user.username}" удален`);
      } catch (err) {
        if (err?.message === 'admin_delete_forbidden') {
          ui.setStatus('Нельзя удалить пользователя admin', false);
          return;
        }
        ui.setStatus('Не удалось удалить пользователя', false);
      }
    }
  );
}

async function checkAuth() {
  state.targetByDevice = loadTargets();
  ui.applyObjectTheme(state.currentObject || '');
  try {
    await refreshObjects();
    await loadAdminDevices();
    await loadAdminUsers();
    ws.connect({
      onOpen: () => {
        if (state.currentObject) {
          requestDevices(state.currentObject);
        }
      },
      onMessage: handleWsMessage
    });
    ui.show('objects');
  } catch (err) {
    ui.show('login');
  }
}

ui.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(ui.loginForm);
  const payload = Object.fromEntries(formData.entries());
  try {
    await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    ui.setStatus('Онлайн');
    await checkAuth();
  } catch (err) {
    ui.setStatus('Ошибка входа', false);
  }
});

ui.logoutBtn.addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (err) {
    // ignore
  }
  ws.close();
  detachCurrentDeviceSession();
  state.currentObject = null;
  state.currentDevice = null;
  state.currentDeviceData = null;
  setCurrentTarget('local', null);
  ui.show('login');
});

ui.menuObjectsBtn?.addEventListener('click', () => {
  detachCurrentDeviceSession();
  ui.applyObjectTheme(state.currentObject || '');
  ui.show('objects');
});

ui.menuDevicesBtn?.addEventListener('click', () => {
  if (!state.currentObject) {
    ui.show('objects');
    return;
  }
  detachCurrentDeviceSession();
  ui.applyObjectTheme(state.currentObject);
  ui.devicesObject.textContent = `Объект: ${state.currentObject}`;
  requestDevices(state.currentObject);
  ui.show('devices');
});

ui.menuSettingsBtn?.addEventListener('click', async () => {
  detachCurrentDeviceSession();
  try {
    await refreshObjects();
    await loadAdminDevices();
    await loadAdminUsers();
  } catch (err) {
    ui.setStatus('Не удалось обновить список устройств', false);
  }
  ui.show('settings');
});

ui.backToObjects.addEventListener('click', () => {
  state.currentObject = null;
  state.devices = [];
  ui.applyObjectTheme('');
  ui.show('objects');
});

ui.backToDevices.addEventListener('click', () => {
  leaveDevice();
});

ui.backToDevicesFromControllers.addEventListener('click', () => {
  leaveDevice();
});

ui.backToControllersFromSockets.addEventListener('click', () => {
  if (!state.currentDevice) return;
  ui.show('deviceControllers');
});

ui.backToControllersFromLights.addEventListener('click', () => {
  if (!state.currentDevice) return;
  ui.show('deviceControllers');
});

ui.backToControllersFromTanks.addEventListener('click', () => {
  if (!state.currentDevice) return;
  ui.show('deviceControllers');
});

ui.backToControllersFromSecurity.addEventListener('click', () => {
  if (!state.currentDevice) return;
  ui.show('deviceControllers');
});

ui.backToControllersFromMeteo.addEventListener('click', () => {
  if (!state.currentDevice) return;
  ui.show('deviceControllers');
});

ui.backToControllersFromThermo?.addEventListener('click', () => {
  if (!state.currentDevice) return;
  ui.show('deviceControllers');
});

ui.backToControllersFromSeptic?.addEventListener('click', () => {
  if (!state.currentDevice) return;
  ui.show('deviceControllers');
});

ui.backToControllersFromWatering?.addEventListener('click', () => {
  if (!state.currentDevice) return;
  ui.show('deviceControllers');
});

ui.backToControllersFromRing?.addEventListener('click', () => {
  if (!state.currentDevice) return;
  ui.show('deviceControllers');
});

ui.backToControllersFromAvr?.addEventListener('click', () => {
  if (!state.currentDevice) return;
  ui.show('deviceControllers');
});

ui.backToControllersFromLeak?.addEventListener('click', () => {
  if (!state.currentDevice) return;
  ui.show('deviceControllers');
});

ui.backToDevicesFromNetwork.addEventListener('click', () => {
  leaveDevice();
});


ui.menuStatusBtn?.addEventListener('click', () => {
  if (!state.currentDevice) return;
  ui.show('device');
});

ui.menuControllersBtn?.addEventListener('click', () => {
  if (!state.currentDevice) return;
  ui.show('deviceControllers');
});

ui.menuNetworkBtn?.addEventListener('click', () => {
  if (!state.currentDevice) return;
  ui.show('deviceNetwork');
});

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-empty-refresh="1"]')) {
    if (state.currentDevice) requestDeviceSnapshot();
    return;
  }
  if (e.target.closest('[data-empty-devices-refresh="1"]')) {
    if (state.currentObject) requestDevices(state.currentObject);
  }
});

function leaveDevice() {
  detachCurrentDeviceSession();
  ui.show('devices');
}

function detachCurrentDeviceSession() {
  stopDevicePolling();
  if (state.currentDevice) {
    unsubscribeDevice(state.currentDevice.device_id);
  }
  clearAllLightPending();
  state.currentDevice = null;
  state.currentDeviceData = null;
  setCurrentTarget('local', null);
  ui.setDeviceNotice('');
  ui.setSocketsNotice('');
  ui.setLightsNotice('');
  ui.setTanksNotice('');
  ui.setSecurityNotice('');
  ui.setMeteoNotice('');
  ui.setThermoNotice('');
  ui.setSepticNotice('');
  ui.setWateringNotice('');
  ui.setRingNotice('');
  ui.setAvrNotice('');
  ui.setLeakNotice('');
  ui.setContentLoading(false);
}

function startDevicePolling() {
  stopDevicePolling();
  devicePollTimer = setInterval(() => {
    if (!state.currentDevice) return;
    sendGet(['system', 'controllers'], state.currentUnit, state.currentNodeId);
  }, DEVICE_POLL_INTERVAL_MS);
}

function stopDevicePolling() {
  if (!devicePollTimer) return;
  clearInterval(devicePollTimer);
  devicePollTimer = null;
}

ui.objectForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(ui.objectForm);
  const name = String(formData.get('name') || '').trim();
  const icon = String(formData.get('icon') || 'house');
  if (!name) {
    ui.setStatus('Введите название объекта', false);
    return;
  }
  try {
    await api('/api/admin/objects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon })
    });
    ui.objectForm.reset();
    await refreshObjects();
    ui.setStatus(`Объект "${name}" добавлен`);
  } catch (err) {
    if (err?.message === 'object_exists') {
      ui.setStatus('Такой объект уже существует', false);
      return;
    }
    ui.setStatus('Ошибка добавления объекта', false);
  }
});

ui.deviceForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(ui.deviceForm);
  const payload = Object.fromEntries(formData.entries());
  try {
    await api('/api/admin/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    ui.deviceForm.reset();
    await refreshObjects();
    await loadAdminDevices();
  } catch (err) {
    ui.setStatus('Ошибка добавления устройства', false);
  }
});

ui.userForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(ui.userForm);
  const payload = Object.fromEntries(formData.entries());
  try {
    await api('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    ui.userForm.reset();
    await loadAdminUsers();
    ui.setStatus(`Пользователь "${payload.username}" добавлен`);
  } catch (err) {
    if (err?.message === 'user_exists') {
      ui.setStatus('Такой пользователь уже существует', false);
      return;
    }
    ui.setStatus('Ошибка добавления пользователя', false);
  }
});

ui.bindTargetPicker((unit, nodeId) => {
  const changed = setCurrentTarget(unit, nodeId);
  if (changed) {
    clearAllLightPending();
  }
  renderTargetPicker(state.currentDeviceData);
  if (changed) {
    requestDeviceSnapshot();
  }
  ui.show('device');
});

ui.deviceControllersGrid?.addEventListener('click', (e) => {
  const card = e.target.closest('[data-controller]');
  if (!card || !state.currentDevice) return;
  const controller = card.dataset.controller;
  if (controller === 'sockets') {
    ui.show('deviceSockets');
    return;
  }
  if (controller === 'lights') {
    ui.show('deviceLights');
    return;
  }
  if (controller === 'tanks') {
    ui.show('deviceTanks');
    return;
  }
  if (controller === 'security') {
    ui.show('deviceSecurity');
    return;
  }
  if (controller === 'meteo') {
    ui.show('deviceMeteo');
    return;
  }
  if (controller === 'thermo') {
    ui.show('deviceThermo');
    return;
  }
  if (controller === 'septic') {
    ui.show('deviceSeptic');
    return;
  }
  if (controller === 'watering') {
    ui.show('deviceWatering');
    return;
  }
  if (controller === 'ring') {
    ui.show('deviceRing');
    return;
  }
  if (controller === 'avr') {
    ui.show('deviceAvr');
    return;
  }
  if (controller === 'leak') {
    ui.show('deviceLeak');
  }
});

ui.deviceSocketsGrid?.addEventListener('click', (e) => {
  const visual = e.target.closest('.socket-visual');
  const actionEl = e.target.closest('[data-action="toggle"]');
  const tile = e.target.closest('[data-socket-id]');
  if ((!visual && !actionEl) || !tile) return;
  if (tile.classList.contains('disabled')) return;
  if (!state.currentDevice) return;
  const socketId = Number(tile.dataset.socketId);
  if (!Number.isFinite(socketId)) return;
  markTilePending(tile);
  sendCmd('sockets', 'toggle', { id: socketId });
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 400);
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 1400);
});

ui.deviceLightsGrid?.addEventListener('click', (e) => {
  const visual = e.target.closest('.light-visual');
  const actionEl = e.target.closest('[data-action="toggle"]');
  const tile = e.target.closest('[data-light-id]');
  if ((!visual && !actionEl) || !tile) return;
  if (tile.classList.contains('disabled')) return;
  if (!state.currentDevice) return;
  const lightId = Number(tile.dataset.lightId);
  if (!Number.isFinite(lightId)) return;
  const pendingKey = lightScopeKey(lightId);
  if (lightPendingOps.has(pendingKey)) return;
  const visualEl = tile.querySelector('.light-visual');
  const currentOn = visualEl ? visualEl.classList.contains('on') : false;
  beginLightPending(lightId, !currentOn);
  sendCmd('lights', 'toggle', { id: lightId });
  triggerLightPoll(pendingKey, 0);
});

ui.deviceTanksGrid?.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action="power-toggle"]');
  const tile = e.target.closest('[data-tank-id]');
  if (!actionEl || !tile) return;
  if (tile.classList.contains('disabled')) return;
  if (!state.currentDevice) return;
  const tankId = Number(tile.dataset.tankId);
  if (!Number.isFinite(tankId)) return;
  const currentPowerOn = tile.dataset.powerOn === '1';
  const nextState = currentPowerOn ? 'off' : 'on';
  markTilePending(tile);
  sendCmd('tanks', 'power', { id: tankId, state: nextState });
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 500);
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 1500);
});

ui.deviceSecurityActions?.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl || !state.currentDevice) return;
  const action = actionEl.dataset.action;
  if (!action) return;
  markButtonPending(actionEl);
  sendCmd('security', action, {});
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 500);
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 1500);
});

ui.deviceThermoGrid?.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  const tile = e.target.closest('[data-thermo-id]');
  if (!actionEl || !tile || !state.currentDevice) return;
  if (tile.classList.contains('disabled')) return;
  const id = Number(tile.dataset.thermoId);
  if (!Number.isFinite(id)) return;
  const action = actionEl.dataset.action;
  if (action === 'power-toggle') {
    const powerOn = tile.dataset.powerOn === '1';
    markTilePending(tile);
    sendCmd('thermo', 'power', { id, state: powerOn ? 'off' : 'on' });
  } else if (action === 'mode-cycle') {
    const currentMode = String(tile.dataset.mode || 'off');
    const modes = ['off', 'heat_only', 'cool_only', 'auto'];
    const idx = modes.indexOf(currentMode);
    const nextMode = modes[(idx + 1) % modes.length];
    markTilePending(tile);
    sendCmd('thermo', 'mode', { id, mode: nextMode });
  } else if (action === 'target-up' || action === 'target-down') {
    const currentTarget = Number(tile.dataset.target);
    if (!Number.isFinite(currentTarget)) return;
    const delta = action === 'target-up' ? 0.5 : -0.5;
    const nextTarget = Math.round((currentTarget + delta) * 10) / 10;
    markTilePending(tile);
    sendCmd('thermo', 'target', { id, target_c: nextTarget });
  } else {
    return;
  }
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 500);
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 1500);
});

ui.deviceSepticGrid?.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  const tile = e.target.closest('[data-septic-id]');
  if (!actionEl || !tile || !state.currentDevice) return;
  if (tile.classList.contains('disabled')) return;
  const id = Number(tile.dataset.septicId);
  if (!Number.isFinite(id)) return;
  if (actionEl.dataset.action !== 'monitor-toggle') return;
  const monitor = tile.dataset.monitor === '1';
  markTilePending(tile);
  sendCmd('septic', 'monitor', { id, state: monitor ? 'off' : 'on' });
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 500);
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 1500);
});

ui.deviceWateringGrid?.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  const tile = e.target.closest('[data-watering-id]');
  if (!actionEl || !tile || !state.currentDevice) return;
  if (tile.classList.contains('disabled')) return;
  const id = Number(tile.dataset.wateringId);
  if (!Number.isFinite(id)) return;
  if (actionEl.dataset.action !== 'status-toggle') return;
  const status = tile.dataset.status === '1';
  markTilePending(tile);
  sendCmd('watering', 'status', { id, state: status ? 'off' : 'on' });
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 500);
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 1500);
});

ui.deviceRingWrap?.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('[data-action="ring-hold"]');
  if (!btn || !state.currentDevice || btn.disabled) return;
  const card = btn.closest('.ring-card');
  markTilePending(card, 900);
  sendCmd('ring', 'hold', { state: 'on' });
});

function releaseRingHold() {
  if (!state.currentDevice) return;
  sendCmd('ring', 'hold', { state: 'off' });
}

ui.deviceRingWrap?.addEventListener('pointerup', (e) => {
  if (!e.target.closest('[data-action="ring-hold"]')) return;
  releaseRingHold();
});
ui.deviceRingWrap?.addEventListener('pointerleave', (e) => {
  if (!e.target.closest('[data-action="ring-hold"]')) return;
  releaseRingHold();
});
ui.deviceRingWrap?.addEventListener('pointercancel', (e) => {
  if (!e.target.closest('[data-action="ring-hold"]')) return;
  releaseRingHold();
});

ui.deviceAvrWrap?.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl || !state.currentDevice || actionEl.disabled) return;
  const tile = e.target.closest('[data-auto-mode]') || ui.deviceAvrWrap.querySelector('[data-auto-mode]');
  const action = actionEl.dataset.action;
  if (action === 'auto-toggle') {
    const autoMode = tile && tile.dataset.autoMode === '1';
    markTilePending(tile);
    sendCmd('avr', 'auto', { state: autoMode ? 'off' : 'on' });
  } else if (action === 'source') {
    const source = String(actionEl.dataset.source || '');
    if (!source) return;
    markTilePending(tile);
    sendCmd('avr', 'source', { source });
  } else if (action === 'clear-fault') {
    markTilePending(tile);
    sendCmd('avr', 'clear_fault', {});
  } else {
    return;
  }
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 500);
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 1500);
});

ui.deviceLeakActions?.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl || !state.currentDevice) return;
  if (actionEl.dataset.action !== 'ack_all') return;
  markButtonPending(actionEl);
  sendCmd('leak', 'ack_all', {});
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 500);
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 1500);
});

ui.deviceLeakGrid?.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  const tile = e.target.closest('[data-leak-id]');
  if (!actionEl || !tile || !state.currentDevice) return;
  if (tile.classList.contains('disabled')) return;
  const id = Number(tile.dataset.leakId);
  if (!Number.isFinite(id)) return;
  const action = actionEl.dataset.action;
  if (action === 'power-toggle') {
    const powerOn = tile.dataset.powerOn === '1';
    markTilePending(tile);
    sendCmd('leak', 'power', { id, state: powerOn ? 'off' : 'on' });
  } else if (action === 'ack') {
    markTilePending(tile, 1000);
    sendCmd('leak', 'ack', { id });
  } else {
    return;
  }
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 500);
  setTimeout(() => requestDeviceSnapshot({ loading: false }), 1500);
});

function selectObject(name) {
  state.currentObject = name;
  ui.applyObjectTheme(name);
  ui.devicesObject.textContent = `Объект: ${name}`;
  requestDevices(name);
  ui.show('devices');
}

function selectDevice(device) {
  clearAllLightPending();
  const isVirtual = Boolean(device?.virtual);
  if (isVirtual) {
    const masterDevice = (state.devicesRaw || []).find(d => Number(d?.device_id) === Number(device.master_device_id));
    if (!masterDevice) {
      ui.setStatus('Мастер устройства недоступен', false);
      return;
    }
    selectDevice({
      ...masterDevice,
      preselectedTarget: {
        unit: 'stack',
        node_id: Number(device.node_id)
      },
      openDirect: true
    });
    return;
  }

  state.currentDevice = device;
  state.currentDeviceData = null;
  const preset = device.preselectedTarget;
  if (preset && preset.unit === 'stack' && preset.node_id) {
    setCurrentTarget('stack', preset.node_id);
  } else if (preset && preset.unit === 'local') {
    setCurrentTarget('local', null);
  } else if (!isVirtual) {
    // Selecting a master card in "Устройства онлайн" must force local target.
    setCurrentTarget('local', null);
  } else {
    const saved = state.targetByDevice[String(Number(device.device_id))];
    if (saved && saved.unit === 'stack' && saved.node_id) {
      setCurrentTarget('stack', saved.node_id);
    } else {
      setCurrentTarget('local', null);
    }
  }

  ui.deviceStatusBody.innerHTML = '';
  ui.deviceControllersGrid.innerHTML = '';
  ui.deviceSocketsGrid.innerHTML = '';
  ui.deviceLightsGrid.innerHTML = '';
  ui.deviceTanksGrid.innerHTML = '';
  ui.deviceSecurityGrid.innerHTML = '';
  ui.deviceSecuritySummary.innerHTML = '';
  ui.deviceMeteoGrid.innerHTML = '';
  ui.deviceThermoGrid.innerHTML = '';
  ui.deviceSepticGrid.innerHTML = '';
  ui.deviceWateringGrid.innerHTML = '';
  ui.deviceRingWrap.innerHTML = '';
  ui.deviceAvrWrap.innerHTML = '';
  ui.deviceLeakGrid.innerHTML = '';
  ui.setContentLoading(true);
  ui.deviceWifiBody.innerHTML = '';
  ui.deviceGsmBody.innerHTML = '';
  ui.setDeviceNotice('');
  ui.setSocketsNotice('');
  ui.setLightsNotice('');
  ui.setTanksNotice('');
  ui.setSecurityNotice('');
  ui.setMeteoNotice('');
  ui.setThermoNotice('');
  ui.setSepticNotice('');
  ui.setWateringNotice('');
  ui.setRingNotice('');
  ui.setAvrNotice('');
  ui.setLeakNotice('');
  renderTargetPicker(device);
  subscribeDevice(device.device_id);
  requestDeviceSnapshot();
  startDevicePolling();
  ui.show('device');
}

async function requestDevices(objectName) {
  const requestId = ++devicesRequestSeq;
  ws.send({ type: 'list_devices', object_name: objectName });
  try {
    const data = await api(`/api/devices?object=${encodeURIComponent(objectName)}`);
    if (requestId !== devicesRequestSeq) return;
    if (state.currentObject !== objectName) return;
    state.devicesRaw = Array.isArray(data.devices) ? data.devices : [];
    state.devices = expandDevicesWithVirtual(state.devicesRaw);
    ui.renderDevices(selectDevice);
  } catch (err) {
    // keep WS-driven state if HTTP fallback fails
  }
}

function subscribeDevice(deviceId) {
  ws.send({ type: 'subscribe_device', device_id: deviceId });
}

function unsubscribeDevice(deviceId) {
  ws.send({ type: 'unsubscribe_device', device_id: deviceId });
}

function sendGet(what, unit = 'local', nodeId = null) {
  if (!state.currentDevice) return;
  ws.send({
    type: 'send_get',
    device_id: state.currentDevice.device_id,
    what,
    unit,
    node_id: nodeId || undefined
  });
}

function sendCmd(controller, action, args = {}, unit = state.currentUnit, nodeId = state.currentNodeId) {
  if (!state.currentDevice) return;
  ws.send({
    type: 'send_cmd',
    device_id: state.currentDevice.device_id,
    controller,
    action,
    args,
    unit,
    node_id: nodeId || undefined
  });
}

function lightScopeKey(lightId, unit = state.currentUnit, nodeId = state.currentNodeId, deviceId = state.currentDevice?.device_id) {
  const scopedUnit = unit === 'stack' ? 'stack' : 'local';
  const scopedNodeId = scopedUnit === 'stack' ? Number(nodeId || 0) : 0;
  return `${Number(deviceId || 0)}:${scopedUnit}:${scopedNodeId}:${Number(lightId)}`;
}

function beginLightPending(lightId, expectedState) {
  if (!state.currentDevice) return;
  const key = lightScopeKey(lightId);
  clearLightPending(key);
  lightPendingOps.set(key, {
    key,
    deviceId: Number(state.currentDevice.device_id),
    unit: state.currentUnit === 'stack' ? 'stack' : 'local',
    nodeId: state.currentUnit === 'stack' ? Number(state.currentNodeId || 0) : 0,
    lightId: Number(lightId),
    expectedState: Boolean(expectedState),
    attempts: 0,
    timer: null
  });
  syncLightPendingUi();
}

function clearLightPending(key) {
  const op = lightPendingOps.get(key);
  if (!op) return;
  if (op.timer) {
    clearTimeout(op.timer);
  }
  lightPendingOps.delete(key);
}

function clearLightPendingByScope(deviceId = state.currentDevice?.device_id, unit = state.currentUnit, nodeId = state.currentNodeId) {
  const prefix = `${Number(deviceId || 0)}:${unit === 'stack' ? 'stack' : 'local'}:${unit === 'stack' ? Number(nodeId || 0) : 0}:`;
  for (const key of [...lightPendingOps.keys()]) {
    if (!key.startsWith(prefix)) continue;
    clearLightPending(key);
  }
  syncLightPendingUi();
}

function clearAllLightPending() {
  for (const key of [...lightPendingOps.keys()]) {
    clearLightPending(key);
  }
  syncLightPendingUi();
}

function triggerLightPoll(key, delayMs = LIGHT_POLL_INTERVAL_MS) {
  const op = lightPendingOps.get(key);
  if (!op) return;
  if (op.timer) {
    clearTimeout(op.timer);
  }
  op.timer = setTimeout(() => {
    const active = lightPendingOps.get(key);
    if (!active || !state.currentDevice || Number(state.currentDevice.device_id) !== Number(active.deviceId)) {
      clearLightPending(key);
      return;
    }
    if (active.attempts >= LIGHT_POLL_MAX_ATTEMPTS) {
      clearLightPending(key);
      syncLightPendingUi();
      return;
    }
    active.attempts += 1;
    const now = Date.now();
    if (now - lastLightPollSentMs >= LIGHT_POLL_MIN_SEND_GAP_MS) {
      lastLightPollSentMs = now;
      requestDeviceSnapshot({ loading: false });
    }
    triggerLightPoll(key, LIGHT_POLL_INTERVAL_MS);
  }, delayMs);
}

function syncLightPendingUi() {
  if (!ui.deviceLightsGrid) return;
  if (!state.currentDevice) return;
  const currentDeviceId = Number(state.currentDevice.device_id);
  const currentUnit = state.currentUnit === 'stack' ? 'stack' : 'local';
  const currentNodeId = currentUnit === 'stack' ? Number(state.currentNodeId || 0) : 0;
  const pendingIds = new Set();
  for (const op of lightPendingOps.values()) {
    if (Number(op.deviceId) !== currentDeviceId) continue;
    if (op.unit !== currentUnit) continue;
    if (Number(op.nodeId || 0) !== currentNodeId) continue;
    pendingIds.add(Number(op.lightId));
  }
  const tiles = ui.deviceLightsGrid.querySelectorAll('[data-light-id]');
  tiles.forEach(tile => {
    const id = Number(tile.dataset.lightId);
    const isPending = pendingIds.has(id);
    const btn = tile.querySelector('[data-action="toggle"]');
    if (!btn) return;
    if (isPending) {
      btn.disabled = true;
      return;
    }
    if (!tile.classList.contains('disabled')) {
      btn.disabled = false;
    }
  });
}

function requestDeviceSnapshot(options = {}) {
  if (!state.currentDevice) return;
  const withLoading = options.loading !== false;
  if (withLoading) {
    ui.setContentLoading(true);
  }
  if (state.currentUnit === 'stack' && state.currentNodeId) {
    sendGet(['system', 'controllers'], 'stack', state.currentNodeId);
    return;
  }
  sendGet(['system', 'controllers', 'stack'], 'local');
}

function mergeDeviceData(prev, next) {
  if (!prev) return next;
  return {
    ...prev,
    ...next,
    system: next.system ?? prev.system,
    controllers: next.controllers ?? prev.controllers,
    stack: next.stack ?? prev.stack,
    stack_units: next.stack_units ?? prev.stack_units,
    last_event: next.last_event ?? prev.last_event
  };
}

function resolveScopedDetail(detail) {
  if (!detail) return detail;
  if (state.currentUnit !== 'stack' || !state.currentNodeId) {
    return detail;
  }
  const map = detail.stack_units;
  const key = String(Number(state.currentNodeId));
  const scoped = map && typeof map === 'object' ? map[key] : null;
  const node = Array.isArray(detail?.stack?.nodes)
    ? detail.stack.nodes.find(item => Number(item?.node_id) === Number(state.currentNodeId))
    : null;
  if (!scoped || typeof scoped !== 'object') {
    return {
      ...detail,
      name: node?.name || detail.name,
      online: typeof node?.online === 'boolean' ? Boolean(node.online) : detail.online,
      system: {},
      controllers: {}
    };
  }
  return {
    ...detail,
    name: node?.name || scoped.name || detail.name,
    online: typeof node?.online === 'boolean' ? Boolean(node.online) : (typeof scoped.online === 'boolean' ? Boolean(scoped.online) : detail.online),
    system: scoped.system || {},
    controllers: scoped.controllers || {},
    last_event: scoped.last_event ?? detail.last_event
  };
}

function resolveLightState(detail, lightId) {
  const scoped = resolveScopedDetail(detail);
  const lights = Array.isArray(scoped?.controllers?.lights) ? scoped.controllers.lights : [];
  const match = lights.find(item => Number(item?.id) === Number(lightId));
  if (!match) return null;
  const raw = match.state ?? match.relay_on;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    if (v === '1' || v === 'on' || v === 'true' || v === 'yes') return true;
    if (v === '0' || v === 'off' || v === 'false' || v === 'no' || v === '') return false;
  }
  return Boolean(raw);
}

function reconcileLightPending(detail) {
  if (!state.currentDevice) return;
  const currentDeviceId = Number(state.currentDevice.device_id);
  const keysToClear = [];
  for (const [key, op] of lightPendingOps.entries()) {
    if (Number(op.deviceId) !== currentDeviceId) continue;
    const current = resolveLightState(detail, op.lightId);
    if (current === null) continue;
    if (current === Boolean(op.expectedState)) {
      keysToClear.push(key);
    }
  }
  if (!keysToClear.length) return;
  for (const key of keysToClear) {
    clearLightPending(key);
  }
  syncLightPendingUi();
}

function handleWsMessage(msg) {
  if (msg.type === 'devices_update' && msg.object_name === state.currentObject) {
    state.devicesRaw = msg.devices || [];
    state.devices = expandDevicesWithVirtual(state.devicesRaw);
    ui.renderDevices(selectDevice);
    return;
  }

  if (msg.type === 'device_update' && state.currentDevice && Number(msg.device?.device_id) === Number(state.currentDevice.device_id)) {
    ui.setContentLoading(false);
    state.currentDeviceData = mergeDeviceData(state.currentDeviceData, msg.device);
    renderTargetPicker(state.currentDeviceData);
    const scopedDetail = resolveScopedDetail(state.currentDeviceData);
    ui.renderDevice(scopedDetail);
    ui.renderSockets(scopedDetail);
    ui.renderLights(scopedDetail);
    reconcileLightPending(state.currentDeviceData);
    syncLightPendingUi();
    ui.renderTanks(scopedDetail);
    ui.renderSecurity(scopedDetail);
    ui.renderMeteo(scopedDetail);
    ui.renderThermo(scopedDetail);
    ui.renderSeptic(scopedDetail);
    ui.renderWatering(scopedDetail);
    ui.renderRing(scopedDetail);
    ui.renderAvr(scopedDetail);
    ui.renderLeak(scopedDetail);
    ui.renderNetwork(scopedDetail);
    return;
  }

  if (msg.type === 'device_offline' && state.currentDevice && Number(msg.device_id) === Number(state.currentDevice.device_id)) {
    ui.setContentLoading(false);
    clearAllLightPending();
    ui.setDeviceNotice('Устройство оффлайн');
    ui.setSocketsNotice('Устройство оффлайн');
    ui.setLightsNotice('Устройство оффлайн');
    ui.setTanksNotice('Устройство оффлайн');
    ui.setSecurityNotice('Устройство оффлайн');
    ui.setMeteoNotice('Устройство оффлайн');
    ui.setThermoNotice('Устройство оффлайн');
    ui.setSepticNotice('Устройство оффлайн');
    ui.setWateringNotice('Устройство оффлайн');
    ui.setRingNotice('Устройство оффлайн');
    ui.setAvrNotice('Устройство оффлайн');
    ui.setLeakNotice('Устройство оффлайн');
  }

  if ((msg.type === 'device_online' || msg.type === 'device_offline') && state.currentObject) {
    requestDevices(state.currentObject);
  }

  if (msg.type === 'command_error') {
    ui.setContentLoading(false);
    clearLightPendingByScope();
    ui.setStatus(`Ошибка запроса: ${msg.error}`, false);
    ui.setSocketsNotice(`Ошибка команды: ${msg.error}`);
    ui.setLightsNotice(`Ошибка команды: ${msg.error}`);
    ui.setTanksNotice(`Ошибка команды: ${msg.error}`);
    ui.setSecurityNotice(`Ошибка команды: ${msg.error}`);
    ui.setThermoNotice(`Ошибка команды: ${msg.error}`);
    ui.setSepticNotice(`Ошибка команды: ${msg.error}`);
    ui.setWateringNotice(`Ошибка команды: ${msg.error}`);
    ui.setRingNotice(`Ошибка команды: ${msg.error}`);
    ui.setAvrNotice(`Ошибка команды: ${msg.error}`);
    ui.setLeakNotice(`Ошибка команды: ${msg.error}`);
  }
}

checkAuth();
