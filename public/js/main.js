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
let pendingSingleDeviceAutoOpen = false;

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

async function checkAuth() {
  try {
    await refreshObjects();
    await loadAdminDevices();
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
  state.currentUnit = 'local';
  state.currentNodeId = null;
  ui.show('login');
});

ui.menuObjectsBtn?.addEventListener('click', () => {
  detachCurrentDeviceSession();
  pendingSingleDeviceAutoOpen = false;
  ui.show('objects');
});

ui.menuSettingsBtn?.addEventListener('click', async () => {
  detachCurrentDeviceSession();
  try {
    await refreshObjects();
    await loadAdminDevices();
  } catch (err) {
    ui.setStatus('Не удалось обновить список устройств', false);
  }
  ui.show('settings');
});

ui.backToObjects.addEventListener('click', () => {
  state.currentObject = null;
  state.devices = [];
  pendingSingleDeviceAutoOpen = false;
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

function leaveDevice() {
  detachCurrentDeviceSession();
  ui.show('devices');
}

function detachCurrentDeviceSession() {
  stopDevicePolling();
  if (state.currentDevice) {
    unsubscribeDevice(state.currentDevice.device_id);
  }
  state.currentDevice = null;
  state.currentDeviceData = null;
  state.currentUnit = 'local';
  state.currentNodeId = null;
  ui.setDeviceNotice('');
  ui.setSocketsNotice('');
  ui.setLightsNotice('');
  ui.setTanksNotice('');
  ui.setSecurityNotice('');
  ui.setMeteoNotice('');
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

ui.deviceScope?.addEventListener('change', () => {
  const value = ui.deviceScope.value || 'local';
  if (value === 'local') {
    state.currentUnit = 'local';
    state.currentNodeId = null;
  } else if (value.startsWith('stack:')) {
    state.currentUnit = 'stack';
    state.currentNodeId = Number(value.split(':')[1]);
  }
  requestDeviceSnapshot();
});

ui.socketsScope?.addEventListener('change', () => {
  const value = ui.socketsScope.value || 'local';
  if (value === 'local') {
    state.currentUnit = 'local';
    state.currentNodeId = null;
  } else if (value.startsWith('stack:')) {
    state.currentUnit = 'stack';
    state.currentNodeId = Number(value.split(':')[1]);
  }
  requestDeviceSnapshot();
});

ui.lightsScope?.addEventListener('change', () => {
  const value = ui.lightsScope.value || 'local';
  if (value === 'local') {
    state.currentUnit = 'local';
    state.currentNodeId = null;
  } else if (value.startsWith('stack:')) {
    state.currentUnit = 'stack';
    state.currentNodeId = Number(value.split(':')[1]);
  }
  requestDeviceSnapshot();
});

ui.tanksScope?.addEventListener('change', () => {
  const value = ui.tanksScope.value || 'local';
  if (value === 'local') {
    state.currentUnit = 'local';
    state.currentNodeId = null;
  } else if (value.startsWith('stack:')) {
    state.currentUnit = 'stack';
    state.currentNodeId = Number(value.split(':')[1]);
  }
  requestDeviceSnapshot();
});

ui.securityScope?.addEventListener('change', () => {
  const value = ui.securityScope.value || 'local';
  if (value === 'local') {
    state.currentUnit = 'local';
    state.currentNodeId = null;
  } else if (value.startsWith('stack:')) {
    state.currentUnit = 'stack';
    state.currentNodeId = Number(value.split(':')[1]);
  }
  requestDeviceSnapshot();
});

ui.meteoScope?.addEventListener('change', () => {
  const value = ui.meteoScope.value || 'local';
  if (value === 'local') {
    state.currentUnit = 'local';
    state.currentNodeId = null;
  } else if (value.startsWith('stack:')) {
    state.currentUnit = 'stack';
    state.currentNodeId = Number(value.split(':')[1]);
  }
  requestDeviceSnapshot();
});

ui.refreshDeviceBtn?.addEventListener('click', () => {
  requestDeviceSnapshot();
});

ui.refreshSocketsBtn?.addEventListener('click', () => {
  requestDeviceSnapshot();
});

ui.refreshLightsBtn?.addEventListener('click', () => {
  requestDeviceSnapshot();
});

ui.refreshTanksBtn?.addEventListener('click', () => {
  requestDeviceSnapshot();
});

ui.refreshSecurityBtn?.addEventListener('click', () => {
  requestDeviceSnapshot();
});

ui.refreshMeteoBtn?.addEventListener('click', () => {
  requestDeviceSnapshot();
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
  sendCmd('sockets', 'toggle', { id: socketId });
  ui.setSocketsNotice(`Команда отправлена: toggle #${socketId}`);
  setTimeout(() => requestDeviceSnapshot(), 400);
  setTimeout(() => requestDeviceSnapshot(), 1400);
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
  sendCmd('lights', 'toggle', { id: lightId });
  ui.setLightsNotice(`Команда отправлена: toggle #${lightId}`);
  setTimeout(() => requestDeviceSnapshot(), 400);
  setTimeout(() => requestDeviceSnapshot(), 1400);
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
  sendCmd('tanks', 'power', { id: tankId, state: nextState });
  ui.setTanksNotice(`Команда отправлена: power #${tankId} -> ${nextState}`);
  setTimeout(() => requestDeviceSnapshot(), 500);
  setTimeout(() => requestDeviceSnapshot(), 1500);
});

ui.deviceSecurityActions?.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl || !state.currentDevice) return;
  const action = actionEl.dataset.action;
  if (!action) return;
  sendCmd('security', action, {});
  ui.setSecurityNotice(`Команда отправлена: ${action}`);
  setTimeout(() => requestDeviceSnapshot(), 500);
  setTimeout(() => requestDeviceSnapshot(), 1500);
});

function selectObject(name) {
  state.currentObject = name;
  pendingSingleDeviceAutoOpen = true;
  ui.devicesObject.textContent = `Объект: ${name}`;
  requestDevices(name);
  ui.show('devices');
}

function selectDevice(device) {
  state.currentDevice = device;
  state.currentDeviceData = null;
  state.currentUnit = 'local';
  state.currentNodeId = null;

  ui.deviceTitle.textContent = `${device.name || 'Без имени'} (#${device.device_id})`;
  ui.deviceControllersTitle.textContent = `${device.name || 'Без имени'} (#${device.device_id})`;
  ui.deviceSocketsTitle.textContent = `${device.name || 'Без имени'} (#${device.device_id})`;
  ui.deviceLightsTitle.textContent = `${device.name || 'Без имени'} (#${device.device_id})`;
  ui.deviceTanksTitle.textContent = `${device.name || 'Без имени'} (#${device.device_id})`;
  ui.deviceSecurityTitle.textContent = `${device.name || 'Без имени'} (#${device.device_id})`;
  ui.deviceMeteoTitle.textContent = `${device.name || 'Без имени'} (#${device.device_id})`;
  ui.deviceNetworkTitle.textContent = `${device.name || 'Без имени'} (#${device.device_id})`;
  ui.deviceStatusBody.innerHTML = '';
  ui.deviceControllersGrid.innerHTML = '';
  ui.deviceSocketsGrid.innerHTML = '';
  ui.deviceLightsGrid.innerHTML = '';
  ui.deviceTanksGrid.innerHTML = '';
  ui.deviceSecurityGrid.innerHTML = '';
  ui.deviceSecuritySummary.innerHTML = '';
  ui.deviceMeteoGrid.innerHTML = '';
  ui.deviceWifiBody.innerHTML = '';
  ui.deviceGsmBody.innerHTML = '';
  ui.setDeviceNotice('');
  ui.setSocketsNotice('');
  ui.setLightsNotice('');
  ui.setTanksNotice('');
  ui.setSecurityNotice('');
  ui.setMeteoNotice('');
  ui.renderScopeOptions(null, state.currentUnit, state.currentNodeId);

  subscribeDevice(device.device_id);
  requestDeviceSnapshot();
  startDevicePolling();
  ui.show('device');
}

function requestDevices(objectName) {
  ws.send({ type: 'list_devices', object_name: objectName });
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

function requestDeviceSnapshot() {
  if (!state.currentDevice) return;
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
    last_event: next.last_event ?? prev.last_event
  };
}

function handleWsMessage(msg) {
  if (msg.type === 'devices_update' && msg.object_name === state.currentObject) {
    state.devices = msg.devices || [];
    if (pendingSingleDeviceAutoOpen) {
      pendingSingleDeviceAutoOpen = false;
      if (state.devices.length === 1) {
        selectDevice(state.devices[0]);
        return;
      }
    }
    ui.renderDevices(selectDevice);
    return;
  }

  if (msg.type === 'device_update' && state.currentDevice && Number(msg.device?.device_id) === Number(state.currentDevice.device_id)) {
    state.currentDeviceData = mergeDeviceData(state.currentDeviceData, msg.device);
    ui.renderScopeOptions(state.currentDeviceData?.stack, state.currentUnit, state.currentNodeId);
    ui.renderDevice(state.currentDeviceData);
    ui.renderSockets(state.currentDeviceData);
    ui.renderLights(state.currentDeviceData);
    ui.renderTanks(state.currentDeviceData);
    ui.renderSecurity(state.currentDeviceData);
    ui.renderMeteo(state.currentDeviceData);
    ui.renderNetwork(state.currentDeviceData);
    return;
  }

  if (msg.type === 'device_offline' && state.currentDevice && Number(msg.device_id) === Number(state.currentDevice.device_id)) {
    ui.setDeviceNotice('Устройство оффлайн');
    ui.setSocketsNotice('Устройство оффлайн');
    ui.setLightsNotice('Устройство оффлайн');
    ui.setTanksNotice('Устройство оффлайн');
    ui.setSecurityNotice('Устройство оффлайн');
    ui.setMeteoNotice('Устройство оффлайн');
  }

  if ((msg.type === 'device_online' || msg.type === 'device_offline') && state.currentObject) {
    requestDevices(state.currentObject);
  }

  if (msg.type === 'command_error') {
    ui.setStatus(`Ошибка запроса: ${msg.error}`, false);
    ui.setSocketsNotice(`Ошибка команды: ${msg.error}`);
    ui.setLightsNotice(`Ошибка команды: ${msg.error}`);
    ui.setTanksNotice(`Ошибка команды: ${msg.error}`);
    ui.setSecurityNotice(`Ошибка команды: ${msg.error}`);
  }
}

checkAuth();
