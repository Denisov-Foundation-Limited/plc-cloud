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
import { api } from "./api.js";
import { state } from "./state.js";
import { Ui } from "./ui.js";
import { WebSocketClient } from "./ws.js";

const ui = new Ui({ state });
const ws = new WebSocketClient({ state, ui });
const DEVICE_POLL_INTERVAL_MS = 3000;
const LOCAL_STACK_POLL_INTERVAL_MS = 9000;
const STACK_PENDING_RETRY_MS = 800;
const STACK_PENDING_RETRY_MAX_ATTEMPTS = 8;
let devicePollTimer = null;
let stackPendingRetryTimer = null;
let stackPendingRetryAttempts = 0;
const socketPendingOps = new Map();
const lightPendingOps = new Map();
const SOCKET_POLL_INTERVAL_MS = 700;
const SOCKET_POLL_MAX_ATTEMPTS = 4;
const SOCKET_POLL_MIN_SEND_GAP_MS = 550;
const LIGHT_POLL_INTERVAL_MS = 700;
const LIGHT_POLL_MAX_ATTEMPTS = 4;
const LIGHT_POLL_MIN_SEND_GAP_MS = 550;
const UI_PENDING_MS = 1400;
let devicesRequestSeq = 0;
let lastSocketPollSentMs = 0;
let lastLightPollSentMs = 0;
let lastLocalStackPollSentMs = 0;
let commandRefreshTimer = null;
const TARGET_STORE_KEY = "plc_cloud_target_by_device";
const tilePendingTimers = new WeakMap();
const buttonPendingTimers = new WeakMap();
const lastEventSignatureByScope = new Map();
let eventToastHost = null;

function setActionButtonsDisabled(root, disabled) {
    if (!root) return;
    root.querySelectorAll("[data-action]").forEach((btn) => {
        if (btn.closest(".disabled")) return;
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
    root.classList.remove("pending");
    setActionButtonsDisabled(root, false);
}

function markTilePending(root, ms = UI_PENDING_MS) {
    if (!root || root.classList.contains("disabled")) return;
    clearTilePending(root);
    setActionButtonsDisabled(root, true);
    const timer = setTimeout(
        () => {
            clearTilePending(root);
        },
        Math.max(300, Number(ms) || UI_PENDING_MS),
    );
    tilePendingTimers.set(root, timer);
}

function markButtonPending(btn, ms = UI_PENDING_MS) {
    if (!btn || btn.disabled) return;
    const timer = buttonPendingTimers.get(btn);
    if (timer) clearTimeout(timer);
    btn.disabled = true;
    buttonPendingTimers.set(
        btn,
        setTimeout(
            () => {
                if (!btn.closest(".disabled")) btn.disabled = false;
                buttonPendingTimers.delete(btn);
            },
            Math.max(300, Number(ms) || UI_PENDING_MS),
        ),
    );
}

function installPressedState() {
    document.addEventListener("pointerdown", (e) => {
        const btn = e.target.closest("[data-action]");
        if (!btn || btn.disabled) return;
        btn.classList.add("is-pressed");
    });
    const clearPressed = (e) => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        btn.classList.remove("is-pressed");
    };
    document.addEventListener("pointerup", clearPressed);
    document.addEventListener("pointercancel", clearPressed);
    document.addEventListener("pointerleave", clearPressed, true);
}

installPressedState();

function loadTargets() {
    try {
        const raw = window.localStorage.getItem(TARGET_STORE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
        return {};
    }
}

function saveTargets() {
    try {
        window.localStorage.setItem(
            TARGET_STORE_KEY,
            JSON.stringify(state.targetByDevice || {}),
        );
    } catch (err) {
        // ignore storage errors
    }
}

function clearStackPendingRetry() {
    if (stackPendingRetryTimer) {
        clearTimeout(stackPendingRetryTimer);
        stackPendingRetryTimer = null;
    }
    stackPendingRetryAttempts = 0;
}

function hasOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function isScopedStackSystemPending(detail) {
    if (state.currentUnit !== "stack" || !state.currentNodeId) return false;
    const scoped = resolveScopedDetail(detail);
    const system = scoped?.system && typeof scoped.system === "object"
        ? scoped.system
        : null;
    if (!system) return true;
    const rtc =
        system.rtc && typeof system.rtc === "object" ? system.rtc : null;
    const plc =
        system.plc && typeof system.plc === "object" ? system.plc : null;
    const hasRtc =
        !!rtc &&
        (hasOwn(rtc, "date") ||
            hasOwn(rtc, "time") ||
            hasOwn(rtc, "temp_c"));
    const hasPlc =
        !!plc &&
        (hasOwn(plc, "board_temp") || hasOwn(plc, "cpu_temp"));
    return !(hasRtc || hasPlc);
}

function scheduleStackPendingRetry(detail) {
    if (state.currentUnit !== "stack" || !state.currentNodeId) {
        clearStackPendingRetry();
        return;
    }
    if (!isScopedStackSystemPending(detail)) {
        clearStackPendingRetry();
        if (ui.deviceNotice?.textContent === "Ожидание данных слейва...") {
            ui.setDeviceNotice("");
        }
        return;
    }
    ui.setDeviceNotice("Ожидание данных слейва...");
    if (stackPendingRetryTimer) return;
    if (stackPendingRetryAttempts >= STACK_PENDING_RETRY_MAX_ATTEMPTS) return;
    stackPendingRetryTimer = setTimeout(() => {
        stackPendingRetryTimer = null;
        stackPendingRetryAttempts += 1;
        if (!state.currentDevice || state.currentUnit !== "stack" || !state.currentNodeId)
            return;
        sendGet(["system", "controllers"], "stack", state.currentNodeId);
        scheduleStackPendingRetry(state.currentDeviceData);
    }, STACK_PENDING_RETRY_MS);
}

function currentScopeKey(detail = null) {
    const deviceId = Number(detail?.device_id || state.currentDevice?.device_id || 0);
    const unit = state.currentUnit === "stack" ? "stack" : "local";
    const nodeId = unit === "stack" ? Number(state.currentNodeId || 0) : 0;
    return `${deviceId}:${unit}:${nodeId}`;
}

function eventSignature(eventPayload) {
    if (!eventPayload || typeof eventPayload !== "object") return "";
    return JSON.stringify({
        kind: eventPayload.kind || "",
        reason: eventPayload.reason || "",
        unit: eventPayload.unit || "",
        node_id: eventPayload.node_id || 0,
        data: eventPayload.data || null,
        ts: eventPayload.ts || eventPayload.time || "",
    });
}

function eventPolicyKey(eventPayload = {}) {
    const kind = String(eventPayload?.kind || "").trim();
    const reason = String(eventPayload?.reason || "").trim();
    if (!kind) return "";
    return reason ? `${kind}.${reason}` : kind;
}

function isEventAllowedByPrefs(eventPayload, prefs) {
    const selected = Array.isArray(prefs)
        ? prefs.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
    if (!selected.length) return true;
    const key = eventPolicyKey(eventPayload);
    return key ? selected.includes(key) : false;
}

function ensureEventToastHost() {
    if (eventToastHost && document.body.contains(eventToastHost)) return eventToastHost;
    eventToastHost = document.createElement("div");
    eventToastHost.id = "event-toast-host";
    eventToastHost.style.cssText =
        "position:fixed;right:16px;top:16px;display:flex;flex-direction:column;gap:8px;z-index:9999;pointer-events:none;max-width:min(420px,calc(100vw - 32px));";
    document.body.appendChild(eventToastHost);
    return eventToastHost;
}

function buildEventToastText(detail) {
    const eventPayload = detail?.last_event;
    if (!eventPayload || typeof eventPayload !== "object") return "";
    const data =
        eventPayload.data && typeof eventPayload.data === "object"
            ? eventPayload.data
            : {};
    const reason = String(eventPayload.reason || "").trim();
    const kind = String(eventPayload.kind || "event").trim() || "event";
    const deviceName = String(detail?.name || `#${Number(detail?.device_id || 0)}`).trim();
    const objectName = String(detail?.object_name || "").trim();
    const sourceName = String(data.source_name || data.unit_name || "").trim();
    const itemName = String(data.name || "").trim();

    let title = "";

    if (kind === "sockets.state" || kind === "lights.state") {
        const item = itemName || (kind === "lights.state" ? "Свет" : "Розетка");
        const state = data.state ? "включен" : "выключен";
        const icon = kind === "lights.state" ? (data.state ? "💡" : "⚪") : "🔌";
        title = `${icon} ${item} ${state}`;
    } else if (kind === "meteo.sensor") {
        const item = itemName || "Датчик";
        title =
            reason === "alarm"
                ? `⚠️ Ошибка датчика ${item}`
                : `✅ Датчик ${item} восстановлен`;
    } else if (kind === "thermo.power") {
        const item = itemName || "Термостат";
        title = `${data.power_on ? "🌡️" : "⏹️"} Термостат ${item} ${data.power_on ? "включен" : "выключен"}`;
    } else if (kind === "tanks.level") {
        const item = itemName || "Бак";
        title =
            reason === "empty" || data.empty
                ? `🛢 Бак ${item} пуст`
                : `🛢 Состояние бака ${item} изменилось`;
    } else if (kind === "septic.level") {
        const item = itemName || "Септик";
        title =
            reason === "alarm" || data.alarm
                ? `🚨 Тревога септика ${item}`
                : `🚰 Предупреждение септика ${item}`;
    } else if (kind === "security.arm") {
        title = `${data.armed ? "🔐" : "🔓"} Охрана ${data.armed ? "включена" : "снята"}`;
    } else if (kind === "security.alarm") {
        title =
            reason === "alarm" || data.alarm_on
                ? "🚨 Охранная тревога"
                : "✅ Охранная тревога сброшена";
    } else if (kind === "security.detect") {
        const item = itemName || "Датчик";
        if (reason === "clear") {
            title = "✅ Сработки охраны очищены";
        } else if (reason === "silent" || data.silent) {
            title = `🕵️ Тихое срабатывание ${item}`;
        } else {
            title = `🚨 Сработка охраны: ${item}`;
        }
    } else if (kind === "watering.rule") {
        const item = itemName || "Правило";
        const actions = {
            start: "запущен",
            pause_empty: "на паузе из-за пустого бака",
            resume: "возобновлен",
            stop: "остановлен",
            stop_empty: "остановлен из-за пустого бака",
            stop_done: "завершён",
        };
        const icon =
            reason === "start" ? "💧"
            : reason === "resume" ? "▶️"
            : reason === "pause_empty" ? "⏸️"
            : reason === "stop_done" ? "✅"
            : reason === "stop_empty" ? "🛑"
            : "🚿";
        title = `${icon} Полив ${item} ${actions[reason] || "изменился"}`;
    } else if (kind === "ring.hold") {
        title = `${reason === "start" || data.hold_on ? "🔔" : "🔕"} Звонок ${reason === "start" || data.hold_on ? "включен" : "выключен"}`;
    } else if (kind === "avr.main") {
        title =
            reason === "lost"
                ? "🔴 Основной ввод пропал"
                : reason === "restored"
                  ? "🟢 Основной ввод восстановлен"
                  : "⚙️ Состояние основного ввода изменилось";
    } else if (kind === "avr.source") {
        const source = String(data.active_source || "").trim();
        title = source
            ? `🔀 АВР переключен на ${source}`
            : "🔀 АВР переключил источник";
    } else if (kind === "avr.fault") {
        const fault = String(data.fault || "").trim();
        title = fault && fault !== "none"
            ? `🚨 Ошибка АВР: ${fault}`
            : "✅ Ошибка АВР очищена";
    } else if (kind === "leak.zone") {
        const item = itemName || "Зона";
        title =
            reason === "detect" || data.wet
                ? `💦 Протечка: ${item}`
                : `✅ Протечка подтверждена: ${item}`;
    } else if (kind === "rules.trigger") {
        const ruleName = String(data.rule_name || "").trim();
        title = ruleName
            ? `📜 Сработало правило ${ruleName}`
            : "📜 Сработало правило";
    } else if (kind === "stack.node") {
        const unitName = String(data.unit_name || "").trim();
        title = `${data.online ? "🟢" : "⚪"} Узел ${unitName || sourceName || "stack"} ${data.online ? "онлайн" : "оффлайн"}`;
    }

    const pieces = [];
    if (title) pieces.push(title);
    if (sourceName) pieces.push(sourceName);
    if (deviceName) pieces.push(deviceName);
    if (objectName) pieces.push(objectName);
    if (!title) {
        pieces.push(kind);
        if (reason) pieces.push(reason);
        if (itemName) pieces.push(itemName);
    }
    return pieces.filter(Boolean).join(" · ");
}

function showEventToast(text) {
    if (!text) return;
    const host = ensureEventToastHost();
    const toast = document.createElement("div");
    toast.textContent = text;
    toast.style.cssText =
        "background:rgba(12,18,32,.96);color:#fff;border:1px solid rgba(148,163,184,.28);border-radius:14px;padding:12px 14px;box-shadow:0 12px 36px rgba(15,23,42,.24);font:500 14px/1.35 system-ui,sans-serif;opacity:0;transform:translateY(-6px);transition:opacity .18s ease, transform .18s ease;";
    host.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
    });
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(-4px)";
        setTimeout(() => toast.remove(), 220);
    }, 3600);
}

function maybeShowEventToast(detail) {
    const eventPayload = detail?.last_event;
    if (!eventPayload || typeof eventPayload !== "object") return;
    if (!Boolean(state.currentSession?.telegram_notify_events)) return;
    const reason = String(eventPayload.reason || "").trim().toLowerCase();
    if (reason === "periodic") return;
    if (
        !isEventAllowedByPrefs(
            eventPayload,
            state.currentSession?.notification_prefs,
        )
    ) {
        return;
    }
    const key = currentScopeKey(detail);
    const signature = eventSignature(eventPayload);
    const previous = lastEventSignatureByScope.get(key);
    lastEventSignatureByScope.set(key, signature);
    if (!signature || !previous || previous === signature) return;
    showEventToast(buildEventToastText(detail));
}

function setCurrentTarget(unit, nodeId = null) {
    let nextUnit = unit === "stack" ? "stack" : "local";
    let nextNodeId = nextUnit === "stack" ? Number(nodeId) : null;
    if (
        nextUnit === "stack" &&
        (!Number.isFinite(nextNodeId) || nextNodeId <= 0)
    ) {
        nextUnit = "local";
        nextNodeId = null;
    }
    const changed =
        state.currentUnit !== nextUnit ||
        Number(state.currentNodeId || 0) !== Number(nextNodeId || 0);
    state.currentUnit = nextUnit;
    state.currentNodeId = nextNodeId;
    if (!state.currentDevice) return;
    const key = String(Number(state.currentDevice.device_id));
    state.targetByDevice[key] =
        state.currentUnit === "stack" && state.currentNodeId
            ? { unit: "stack", node_id: Number(state.currentNodeId) }
            : { unit: "local", node_id: null };
    saveTargets();
    return changed;
}

function getTargetOptions(detail) {
    const nodes = Array.isArray(detail?.stack?.nodes)
        ? detail.stack.nodes.filter((n) => Number(n?.node_id) > 0)
        : [];
    const deviceId =
        Number(state.currentDevice?.device_id) ||
        Number(detail?.device_id) ||
        0;
    const masterOnline =
        typeof detail?.online === "boolean"
            ? Boolean(detail.online)
            : typeof state.currentDeviceData?.online === "boolean"
              ? Boolean(state.currentDeviceData.online)
              : null;
    const options = [
        {
            unit: "local",
            node_id: null,
            role: "master",
            online: masterOnline,
            label: `Мастер: ${state.currentDevice?.name || detail?.name || "#" + deviceId}`,
        },
    ];
    for (const node of nodes) {
        const nodeId = Number(node.node_id);
        options.push({
            unit: "stack",
            node_id: nodeId,
            role: "slave",
            online:
                typeof node?.online === "boolean" ? Boolean(node.online) : null,
            label: `Слейв: ${node.name || `Stack #${nodeId}`} (#${nodeId})`,
        });
    }
    return options;
}

function renderTargetPicker(detail) {
    const options = getTargetOptions(detail);
    if (state.currentUnit === "stack" && state.currentNodeId) {
        const hasStackNodes = Array.isArray(detail?.stack?.nodes);
        // Do not fallback to local until we actually have stack nodes from device.
        if (hasStackNodes) {
            const exists = options.some(
                (o) =>
                    o.unit === "stack" &&
                    Number(o.node_id) === Number(state.currentNodeId),
            );
            if (!exists) {
                setCurrentTarget("local", null);
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
            virtual: false,
        };
        result.push(master);

        const nodes = Array.isArray(device?.stack?.nodes)
            ? device.stack.nodes
            : [];
        for (const node of nodes) {
            const nodeId = Number(node?.node_id);
            if (!Number.isFinite(nodeId) || nodeId <= 0) continue;
            result.push({
                virtual: true,
                master_device_id: Number(device.device_id),
                master_name: device.name || `#${Number(device.device_id)}`,
                node_id: nodeId,
                online:
                    typeof node?.online === "boolean"
                        ? Boolean(node.online)
                        : true,
                name: node?.name || `Stack #${nodeId}`,
                device_id: `${Number(device.device_id)}:${nodeId}`,
                object_name: device.object_name,
            });
        }
    }
    return result;
}

async function loadObjects() {
    const data = await api("/api/objects");
    state.objects = Array.isArray(data.objects) ? data.objects : [];
    ui.renderObjects(selectObject);
    ui.renderAdminObjects(
        state.objects,
        async (objectName) => {
            try {
                await api(
                    `/api/admin/objects/${encodeURIComponent(objectName)}`,
                    { method: "DELETE" },
                );
                if (state.currentObject === objectName) {
                    state.currentObject = null;
                    state.devices = [];
                }
                await refreshObjects();
                ui.setStatus(`Объект "${objectName}" удален`);
            } catch (err) {
                if (err?.message === "object_has_devices") {
                    ui.setStatus(
                        "Нельзя удалить объект: к нему привязаны устройства",
                        false,
                    );
                    return;
                }
                ui.setStatus("Не удалось удалить объект", false);
            }
        },
        async (objectName) => {
            const nextName = window.prompt(
                "Новое название объекта",
                objectName,
            );
            if (nextName === null) return;
            const trimmed = String(nextName).trim();
            if (!trimmed) {
                ui.setStatus("Введите новое название объекта", false);
                return;
            }
            try {
                await api(
                    `/api/admin/objects/${encodeURIComponent(objectName)}`,
                    {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: trimmed }),
                    },
                );
                if (state.currentObject === objectName) {
                    state.currentObject = trimmed;
                }
                await refreshObjects();
                ui.setStatus(
                    `Объект "${objectName}" переименован в "${trimmed}"`,
                );
            } catch (err) {
                if (err?.message === "object_exists") {
                    ui.setStatus("Такой объект уже существует", false);
                    return;
                }
                if (err?.message === "object_name_same") {
                    ui.setStatus("Новое имя совпадает с текущим", false);
                    return;
                }
                ui.setStatus("Не удалось переименовать объект", false);
            }
        },
        async (objectName, icon) => {
            try {
                await api(
                    `/api/admin/objects/${encodeURIComponent(objectName)}/icon`,
                    {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ icon }),
                    },
                );
                await refreshObjects();
                ui.setStatus(`Иконка объекта "${objectName}" обновлена`);
            } catch (err) {
                ui.setStatus("Не удалось обновить иконку объекта", false);
            }
        },
    );
}

async function refreshObjects() {
    await loadObjects();
}

async function loadAdminDevices() {
    const data = await api("/api/admin/devices");
    ui.renderAdminDevices(
        data.devices || [],
        (state.objects || [])
            .map((row) => (typeof row === "string" ? row : row.name))
            .filter(Boolean),
        async (device) => {
            await api(`/api/admin/devices/${device.device_id}/rotate_key`, {
                method: "POST",
            });
            await loadAdminDevices();
        },
        async (device) => {
            await api(`/api/admin/devices/${device.device_id}`, {
                method: "DELETE",
            });
            await refreshObjects();
            await loadAdminDevices();
        },
        async (device, objectName) => {
            const nextObjectName = String(objectName || "").trim();
            if (!nextObjectName || nextObjectName === device.object_name)
                return;
            try {
                await api(`/api/admin/devices/${device.device_id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ object_name: nextObjectName }),
                });
                await refreshObjects();
                await loadAdminDevices();
                if (state.currentObject) {
                    requestDevices(state.currentObject);
                }
                ui.setStatus(
                    `Устройство #${device.device_id} перенесено в "${nextObjectName}"`,
                );
            } catch (err) {
                ui.setStatus(
                    "Не удалось перенести устройство в другой объект",
                    false,
                );
            }
        },
    );
}

async function loadAdminUsers() {
    const data = await api("/api/admin/users");
    ui.renderUserObjectSelector(data.objects || [], []);
    ui.renderAdminUsers(
        data.users || [],
        data.objects || [],
        data.notification_catalog || [],
        async (user, patch) => {
            try {
                const result = await api(
                    `/api/admin/users/${encodeURIComponent(user.username)}`,
                    {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            username: String(patch?.username || "").trim(),
                            plc_username: String(
                                patch?.plc_username || "",
                            ).trim(),
                            telegram_username: String(
                                patch?.telegram_username || "",
                            ).trim(),
                            chat_id: String(patch?.chat_id || "").trim(),
                            telegram_notify_online: Boolean(
                                patch?.telegram_notify_online,
                            ),
                            telegram_notify_offline: Boolean(
                                patch?.telegram_notify_offline,
                            ),
                            telegram_notify_events: Boolean(
                                patch?.telegram_notify_events,
                            ),
                            notification_prefs: Array.isArray(
                                patch?.notification_prefs,
                            )
                                ? patch.notification_prefs
                                : [],
                            allowed_objects: Array.isArray(
                                patch?.allowed_objects,
                            )
                                ? patch.allowed_objects
                                : [],
                            ...(String(patch?.password || "")
                                ? { password: String(patch.password) }
                                : {}),
                        }),
                    },
                );
                const nextUsername = String(
                    result?.user?.username || patch?.username || user.username,
                ).trim();
                const currentUsername = String(
                    state.currentSession?.username || "",
                ).trim();
                if (
                    currentUsername &&
                    (currentUsername === String(user.username || "").trim() ||
                        currentUsername === nextUsername)
                ) {
                    state.currentSession = {
                        ...(state.currentSession || {}),
                        ...(result?.user && typeof result.user === "object"
                            ? {
                                  username: nextUsername,
                                  plc_username: String(
                                      result.user.plc_username || "",
                                  ).trim(),
                                  telegram_username: String(
                                      result.user.telegram_username || "",
                                  ).trim(),
                                  allowed_objects: Array.isArray(
                                      result.user.allowed_objects,
                                  )
                                      ? result.user.allowed_objects
                                      : [],
                                  notification_prefs: Array.isArray(
                                      result.user.notification_prefs,
                                  )
                                      ? result.user.notification_prefs
                                      : [],
                              }
                            : {}),
                    };
                }
                await loadAdminUsers();
                ui.setStatus(
                    `Пользователь "${String(patch?.username || "").trim() || user.username}" обновлен`,
                );
            } catch (err) {
                ui.setStatus("Не удалось сохранить пользователя", false);
            }
        },
        async (user) => {
            try {
                await api(
                    `/api/admin/users/${encodeURIComponent(user.username)}`,
                    { method: "DELETE" },
                );
                await loadAdminUsers();
                ui.setStatus(`Пользователь "${user.username}" удален`);
            } catch (err) {
                if (err?.message === "admin_delete_forbidden") {
                    ui.setStatus("Нельзя удалить пользователя admin", false);
                    return;
                }
                ui.setStatus("Не удалось удалить пользователя", false);
            }
        },
    );
}

async function loadTelegramSettings() {
    const data = await api("/api/admin/telegram/settings");
    ui.renderTelegramSettings(data.settings || null);
}

async function saveTelegramSettings(payload) {
    const data = await api("/api/admin/telegram/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            token: payload?.token || "",
        }),
    });
    ui.renderTelegramSettings(data.settings || null);
}

async function openSettingsHome() {
    detachCurrentDeviceSession();
    ui.show("settings");
}

async function openSettingsObjects() {
    detachCurrentDeviceSession();
    try {
        await refreshObjects();
    } catch (err) {
        ui.setStatus("Не удалось обновить список объектов", false);
        return;
    }
    ui.show("settingsObjects");
}

async function openSettingsDevices() {
    detachCurrentDeviceSession();
    try {
        await refreshObjects();
        await loadAdminDevices();
    } catch (err) {
        ui.setStatus("Не удалось обновить список устройств", false);
        return;
    }
    ui.show("settingsDevices");
}

async function openSettingsUsers() {
    detachCurrentDeviceSession();
    try {
        await loadAdminUsers();
    } catch (err) {
        ui.setStatus("Не удалось обновить список пользователей", false);
        return;
    }
    ui.show("settingsUsers");
}

async function openSettingsTelegram() {
    detachCurrentDeviceSession();
    try {
        await loadTelegramSettings();
    } catch (err) {
        ui.setStatus("Не удалось загрузить настройки Telegram", false);
        return;
    }
    ui.show("settingsTelegram");
}

async function checkAuth() {
    state.targetByDevice = loadTargets();
    ui.applyObjectTheme(state.currentObject || "");
    try {
        const sessionData = await api("/api/session");
        state.currentSession =
            sessionData?.session && typeof sessionData.session === "object"
                ? sessionData.session
                : null;
        await refreshObjects();
        await loadAdminDevices();
        await loadAdminUsers();
        ws.connect({
            onOpen: () => {
                if (state.currentObject) {
                    requestDevices(state.currentObject);
                }
                if (state.currentDevice) {
                    subscribeDevice(state.currentDevice.device_id);
                    requestDeviceSnapshot({ loading: false });
                }
            },
            onMessage: handleWsMessage,
            onUnauthorized: () => {
                clearStackPendingRetry();
                detachCurrentDeviceSession();
                state.currentSession = null;
                state.currentObject = null;
                state.currentDevice = null;
                state.currentDeviceData = null;
                setCurrentTarget("local", null);
                ui.setStatus("Сессия истекла", false);
                ui.show("login");
            },
        });
        ui.show("objects");
    } catch (err) {
        state.currentSession = null;
        ui.show("login");
    }
}

ui.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(ui.loginForm);
    const payload = Object.fromEntries(formData.entries());
    try {
        await api("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        ui.setStatus("Онлайн");
        await checkAuth();
    } catch (err) {
        ui.setStatus("Ошибка входа", false);
    }
});

ui.logoutBtn.addEventListener("click", async () => {
    try {
        await api("/api/logout", { method: "POST" });
    } catch (err) {
        // ignore
    }
    ws.close();
    detachCurrentDeviceSession();
    state.currentSession = null;
    state.currentObject = null;
    state.currentDevice = null;
    state.currentDeviceData = null;
    setCurrentTarget("local", null);
    ui.show("login");
});

ui.menuObjectsBtn?.addEventListener("click", () => {
    detachCurrentDeviceSession();
    ui.applyObjectTheme(state.currentObject || "");
    ui.show("objects");
});

ui.menuDevicesBtn?.addEventListener("click", () => {
    if (!state.currentObject) {
        ui.show("objects");
        return;
    }
    detachCurrentDeviceSession();
    ui.applyObjectTheme(state.currentObject);
    ui.devicesObject.textContent = `Объект: ${state.currentObject}`;
    requestDevices(state.currentObject);
    ui.show("devices");
});

ui.menuSettingsBtn?.addEventListener("click", async () => {
    await openSettingsHome();
});

ui.settingsObjectsTile?.addEventListener("click", async () => {
    await openSettingsObjects();
});

ui.settingsDevicesTile?.addEventListener("click", async () => {
    await openSettingsDevices();
});

ui.settingsUsersTile?.addEventListener("click", async () => {
    await openSettingsUsers();
});

ui.settingsTelegramTile?.addEventListener("click", async () => {
    await openSettingsTelegram();
});

ui.settingsBackFromObjects?.addEventListener("click", async () => {
    await openSettingsHome();
});

ui.settingsBackFromDevices?.addEventListener("click", async () => {
    await openSettingsHome();
});

ui.settingsBackFromUsers?.addEventListener("click", async () => {
    await openSettingsHome();
});

ui.settingsBackFromTelegram?.addEventListener("click", async () => {
    await openSettingsHome();
});

ui.telegramSettingsForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(ui.telegramSettingsForm);
    const payload = Object.fromEntries(formData.entries());
    try {
        await saveTelegramSettings(payload);
        ui.setStatus("Настройки Telegram сохранены");
    } catch (err) {
        ui.setStatus("Не удалось сохранить настройки Telegram", false);
    }
});

ui.backToObjects.addEventListener("click", () => {
    state.currentObject = null;
    state.devices = [];
    ui.applyObjectTheme("");
    ui.show("objects");
});

ui.backToDevices.addEventListener("click", () => {
    leaveDevice();
});

ui.backToDevicesFromControllers.addEventListener("click", () => {
    leaveDevice();
});

ui.backToControllersFromCameras?.addEventListener("click", () => {
    if (!state.currentDevice) return;
    ui.show("deviceControllers");
});

ui.backToControllersFromSockets.addEventListener("click", () => {
    if (!state.currentDevice) return;
    ui.show("deviceControllers");
});

ui.backToControllersFromLights.addEventListener("click", () => {
    if (!state.currentDevice) return;
    ui.show("deviceControllers");
});

ui.backToControllersFromTanks.addEventListener("click", () => {
    if (!state.currentDevice) return;
    ui.show("deviceControllers");
});

ui.backToControllersFromSecurity.addEventListener("click", () => {
    if (!state.currentDevice) return;
    ui.show("deviceControllers");
});

ui.backToControllersFromMeteo.addEventListener("click", () => {
    if (!state.currentDevice) return;
    ui.show("deviceControllers");
});

ui.backToControllersFromThermo?.addEventListener("click", () => {
    if (!state.currentDevice) return;
    ui.show("deviceControllers");
});

ui.backToControllersFromSeptic?.addEventListener("click", () => {
    if (!state.currentDevice) return;
    ui.show("deviceControllers");
});

ui.backToControllersFromWatering?.addEventListener("click", () => {
    if (!state.currentDevice) return;
    ui.show("deviceControllers");
});

ui.backToControllersFromRing?.addEventListener("click", () => {
    if (!state.currentDevice) return;
    ui.show("deviceControllers");
});

ui.backToControllersFromAvr?.addEventListener("click", () => {
    if (!state.currentDevice) return;
    ui.show("deviceControllers");
});

ui.backToControllersFromLeak?.addEventListener("click", () => {
    if (!state.currentDevice) return;
    ui.show("deviceControllers");
});

ui.backToDevicesFromNetwork.addEventListener("click", () => {
    leaveDevice();
});

ui.menuStatusBtn?.addEventListener("click", () => {
    if (!state.currentDevice) return;
    ui.show("device");
});

ui.menuControllersBtn?.addEventListener("click", () => {
    if (!state.currentDevice) return;
    ui.show("deviceControllers");
});

ui.menuNetworkBtn?.addEventListener("click", () => {
    if (!state.currentDevice) return;
    ui.show("deviceNetwork");
});

document.addEventListener("click", (e) => {
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
    ui.show("devices");
}

function detachCurrentDeviceSession() {
    stopDevicePolling();
    if (state.currentDevice) {
        unsubscribeDevice(state.currentDevice.device_id);
    }
    clearAllSocketPending();
    clearAllLightPending();
    state.currentDevice = null;
    state.currentDeviceData = null;
    setCurrentTarget("local", null);
    ui.setDeviceNotice("");
    ui.setSocketsNotice("");
    ui.setLightsNotice("");
    ui.setTanksNotice("");
    ui.setSecurityNotice("");
    ui.setMeteoNotice("");
    ui.setThermoNotice("");
    ui.setSepticNotice("");
    ui.setWateringNotice("");
    ui.setRingNotice("");
    ui.setAvrNotice("");
    ui.setLeakNotice("");
    ui.setContentLoading(false);
}

function startDevicePolling() {
    stopDevicePolling();
    devicePollTimer = setInterval(() => {
        if (!state.currentDevice) return;
        sendGet(
            ["system", "controllers"],
            state.currentUnit,
            state.currentNodeId,
        );
        if (state.currentUnit === "stack" && state.currentNodeId) {
            const now = Date.now();
            if (
                !lastLocalStackPollSentMs ||
                now - lastLocalStackPollSentMs >= LOCAL_STACK_POLL_INTERVAL_MS
            ) {
                lastLocalStackPollSentMs = now;
                sendGet(["stack", "authz"], "local");
            }
        }
    }, DEVICE_POLL_INTERVAL_MS);
}

function stopDevicePolling() {
    if (!devicePollTimer) return;
    clearInterval(devicePollTimer);
    devicePollTimer = null;
}

ui.objectForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(ui.objectForm);
    const name = String(formData.get("name") || "").trim();
    const icon = String(formData.get("icon") || "house");
    if (!name) {
        ui.setStatus("Введите название объекта", false);
        return;
    }
    try {
        await api("/api/admin/objects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, icon }),
        });
        ui.objectForm.reset();
        await refreshObjects();
        ui.setStatus(`Объект "${name}" добавлен`);
    } catch (err) {
        if (err?.message === "object_exists") {
            ui.setStatus("Такой объект уже существует", false);
            return;
        }
        ui.setStatus("Ошибка добавления объекта", false);
    }
});

ui.deviceForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(ui.deviceForm);
    const payload = Object.fromEntries(formData.entries());
    try {
        await api("/api/admin/devices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        ui.deviceForm.reset();
        await refreshObjects();
        await loadAdminDevices();
    } catch (err) {
        ui.setStatus("Ошибка добавления устройства", false);
    }
});

ui.userForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(ui.userForm);
    const payload = Object.fromEntries(formData.entries());
    const allowedObjects = Array.from(
        ui.userAllowedObjects?.querySelectorAll('input[name="allowed_objects"]:checked') || [],
    )
        .map((input) => String(input.value || "").trim())
        .filter(Boolean);
    const toBool = (value) =>
        value === true ||
        String(value || "")
            .trim()
            .toLowerCase() === "on";
    try {
        await api("/api/admin/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ...payload,
                allowed_objects: allowedObjects,
                telegram_notify_online: toBool(payload.telegram_notify_online),
                telegram_notify_offline: toBool(payload.telegram_notify_offline),
                telegram_notify_events: toBool(payload.telegram_notify_events),
            }),
        });
        ui.userForm.reset();
        await loadAdminUsers();
        ui.setStatus(`Пользователь "${payload.username}" добавлен`);
    } catch (err) {
        if (err?.message === "user_exists") {
            ui.setStatus("Такой пользователь уже существует", false);
            return;
        }
        ui.setStatus("Ошибка добавления пользователя", false);
    }
});

ui.bindTargetPicker((unit, nodeId) => {
    const changed = setCurrentTarget(unit, nodeId);
    if (changed) {
        clearAllSocketPending();
        clearAllLightPending();
        clearStackPendingRetry();
    }
    renderTargetPicker(state.currentDeviceData);
    if (changed) {
        requestDeviceSnapshot();
        scheduleStackPendingRetry(state.currentDeviceData);
    }
    ui.show("device");
});

ui.deviceControllersGrid?.addEventListener("click", (e) => {
    const card = e.target.closest("[data-controller]");
    if (!card || !state.currentDevice) return;
    const controller = card.dataset.controller;
    if (controller === "cameras") {
        ui.show("deviceCameras");
        return;
    }
    if (controller === "sockets") {
        ui.show("deviceSockets");
        return;
    }
    if (controller === "lights") {
        ui.show("deviceLights");
        return;
    }
    if (controller === "tanks") {
        ui.show("deviceTanks");
        return;
    }
    if (controller === "security") {
        ui.show("deviceSecurity");
        return;
    }
    if (controller === "meteo") {
        ui.show("deviceMeteo");
        return;
    }
    if (controller === "thermo") {
        ui.show("deviceThermo");
        return;
    }
    if (controller === "septic") {
        ui.show("deviceSeptic");
        return;
    }
    if (controller === "watering") {
        ui.show("deviceWatering");
        return;
    }
    if (controller === "ring") {
        ui.show("deviceRing");
        return;
    }
    if (controller === "avr") {
        ui.show("deviceAvr");
        return;
    }
    if (controller === "leak") {
        ui.show("deviceLeak");
    }
});

ui.deviceCamerasGrid?.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="snapshot"]');
    const tile = e.target.closest("[data-camera-id]");
    if (!btn || !tile || !state.currentDevice) return;
    if (tile.classList.contains("disabled") || btn.disabled) return;
    const id = Number(tile.dataset.cameraId);
    if (!Number.isFinite(id) || id <= 0) return;
    ui.setCamerasNotice(`Камера #${id}: запрашиваем снимок...`);
    btn.disabled = true;
    const sent = sendCmd("cameras", "snapshot", { id }, "local", null);
    if (!sent) {
        btn.disabled = false;
        ui.setStatus("Оффлайн", false);
        ui.setCamerasNotice(`Камера #${id}: команда не отправлена`);
        return;
    }
    [600, 1800, 3600, 5600].forEach((delayMs) => {
        setTimeout(() => {
            if (!state.currentDevice) return;
            requestDeviceSnapshot({ loading: false });
        }, delayMs);
    });
});

ui.deviceSocketsGrid?.addEventListener("click", (e) => {
    const visual = e.target.closest(".socket-visual");
    const actionEl = e.target.closest('[data-action="toggle"]');
    const tile = e.target.closest("[data-socket-id]");
    if ((!visual && !actionEl) || !tile) return;
    if (tile.classList.contains("disabled")) return;
    if (!state.currentDevice) return;
    const socketId = Number(tile.dataset.socketId);
    if (!Number.isFinite(socketId)) return;
    const pendingKey = socketScopeKey(socketId);
    if (socketPendingOps.has(pendingKey)) return;
    const visualEl = tile.querySelector(".socket-visual");
    const currentOn = visualEl ? visualEl.classList.contains("on") : false;
    beginSocketPending(socketId, !currentOn);
    const sent = sendCmd("sockets", "toggle", { id: socketId });
    if (!sent) {
        clearSocketPending(pendingKey);
        syncSocketPendingUi();
        ui.setStatus("Оффлайн", false);
        ui.setSocketsNotice("Команда не отправлена: нет соединения");
        return;
    }
    if (state.currentDeviceData) {
        state.currentDeviceData = patchSocketState(
            state.currentDeviceData,
            socketId,
            !currentOn,
        );
        const effectiveDetail = applyPendingDeviceOverlay(
            state.currentDeviceData,
        );
        const scopedDetail = resolveScopedDetail(effectiveDetail);
        ui.renderDevice(scopedDetail);
        ui.renderSockets(scopedDetail);
    }
    syncSocketPendingUi();
    triggerSocketPoll(pendingKey, 0);
});

ui.deviceLightsGrid?.addEventListener("click", (e) => {
    const visual = e.target.closest(".light-visual");
    const actionEl = e.target.closest('[data-action="toggle"]');
    const tile = e.target.closest("[data-light-id]");
    if ((!visual && !actionEl) || !tile) return;
    if (tile.classList.contains("disabled")) return;
    if (!state.currentDevice) return;
    const lightId = Number(tile.dataset.lightId);
    if (!Number.isFinite(lightId)) return;
    const pendingKey = lightScopeKey(lightId);
    if (lightPendingOps.has(pendingKey)) return;
    const visualEl = tile.querySelector(".light-visual");
    const currentOn = visualEl ? visualEl.classList.contains("on") : false;
    beginLightPending(lightId, !currentOn);
    sendCmd("lights", "toggle", { id: lightId });
    triggerLightPoll(pendingKey, 0);
});

ui.deviceTanksGrid?.addEventListener("click", (e) => {
    const actionEl = e.target.closest('[data-action="power-toggle"]');
    const tile = e.target.closest("[data-tank-id]");
    if (!actionEl || !tile) return;
    if (tile.classList.contains("disabled")) return;
    if (!state.currentDevice) return;
    const tankId = Number(tile.dataset.tankId);
    if (!Number.isFinite(tankId)) return;
    const currentPowerOn = tile.dataset.powerOn === "1";
    const nextState = currentPowerOn ? "off" : "on";
    markTilePending(tile);
    sendCmd("tanks", "power", { id: tankId, state: nextState });
    scheduleCommandRefresh(1500);
});

ui.deviceSecurityActions?.addEventListener("click", (e) => {
    const actionEl = e.target.closest("[data-action]");
    if (!actionEl || !state.currentDevice) return;
    const action = actionEl.dataset.action;
    if (!action) return;
    markButtonPending(actionEl);
    sendCmd("security", action, {});
    scheduleCommandRefresh(1500);
});

ui.deviceThermoGrid?.addEventListener("click", (e) => {
    const actionEl = e.target.closest("[data-action]");
    const tile = e.target.closest("[data-thermo-id]");
    if (!actionEl || !tile || !state.currentDevice) return;
    if (tile.classList.contains("disabled")) return;
    const id = Number(tile.dataset.thermoId);
    if (!Number.isFinite(id)) return;
    const action = actionEl.dataset.action;
    if (action === "power-toggle") {
        const powerOn = tile.dataset.powerOn === "1";
        markTilePending(tile);
        sendCmd("thermo", "power", { id, state: powerOn ? "off" : "on" });
    } else if (action === "mode-cycle") {
        const currentMode = String(tile.dataset.mode || "off");
        const modes = ["off", "heat_only", "cool_only", "auto"];
        const idx = modes.indexOf(currentMode);
        const nextMode = modes[(idx + 1) % modes.length];
        markTilePending(tile);
        sendCmd("thermo", "mode", { id, mode: nextMode });
    } else if (action === "target-up" || action === "target-down") {
        const currentTarget = Number(tile.dataset.target);
        if (!Number.isFinite(currentTarget)) return;
        const delta = action === "target-up" ? 1 : -1;
        const nextTarget = Math.round(currentTarget + delta);
        markTilePending(tile);
        sendCmd("thermo", "target", { id, target_c: nextTarget });
    } else {
        return;
    }
    scheduleCommandRefresh(1500);
});

ui.deviceSepticGrid?.addEventListener("click", (e) => {
    const actionEl = e.target.closest("[data-action]");
    const tile = e.target.closest("[data-septic-id]");
    if (!actionEl || !tile || !state.currentDevice) return;
    if (tile.classList.contains("disabled")) return;
    const id = Number(tile.dataset.septicId);
    if (!Number.isFinite(id)) return;
    if (actionEl.dataset.action !== "monitor-toggle") return;
    const monitor = tile.dataset.monitor === "1";
    markTilePending(tile);
    sendCmd("septic", "monitor", { id, state: monitor ? "off" : "on" });
    scheduleCommandRefresh(1500);
});

ui.deviceWateringGrid?.addEventListener("click", (e) => {
    const actionEl = e.target.closest("[data-action]");
    const tile = e.target.closest("[data-watering-id]");
    if (!actionEl || !tile || !state.currentDevice) return;
    if (tile.classList.contains("disabled")) return;
    const id = Number(tile.dataset.wateringId);
    if (!Number.isFinite(id)) return;
    const action = actionEl.dataset.action;
    markTilePending(tile);
    if (action === "status-toggle") {
        const status = tile.dataset.status === "1";
        sendCmd("watering", "status", { id, state: status ? "off" : "on" });
    } else if (action === "weekday-toggle") {
        const bit = Number(actionEl.dataset.bit);
        if (!Number.isFinite(bit)) return;
        const currentMask = Number(tile.dataset.weekdaysMask || 0) & 0x7f;
        const nextMask = currentMask ^ (1 << bit);
        sendCmd("watering", "weekdays", { id, weekdays_mask: nextMask });
    } else if (action === "slot-duration-step") {
        const slotEl = actionEl.closest("[data-watering-slot]");
        const slot = Number(actionEl.dataset.slot || slotEl?.dataset.wateringSlot);
        if (!Number.isFinite(slot)) return;
        const input = slotEl?.querySelector(".watering-duration-input");
        if (!input) return;
        const nextValue = Math.max(
            0,
            Number(input.value || 0) + Number(actionEl.dataset.durationDelta || 0),
        );
        input.value = String(nextValue);
        clearTilePending(tile);
        return;
    } else if (action === "slot-save") {
        const slotEl = actionEl.closest("[data-watering-slot]");
        const slot = Number(actionEl.dataset.slot || slotEl?.dataset.wateringSlot);
        if (!Number.isFinite(slot)) return;
        const timeInput = slotEl?.querySelector(".watering-time-input");
        const durationInput = slotEl?.querySelector(".watering-duration-input");
        const rawTime = String(timeInput?.value || "").trim();
        const match = rawTime.match(/^(\d{2}):(\d{2})$/);
        if (!match) return;
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        const durationMinutes = Math.max(0, Number(durationInput?.value || 0));
        if (
            !Number.isFinite(hour) ||
            !Number.isFinite(minute) ||
            hour < 0 ||
            hour > 23 ||
            minute < 0 ||
            minute > 59 ||
            !Number.isFinite(durationMinutes)
        ) {
            return;
        }
        sendCmd("watering", "time", {
            id,
            slot,
            hour,
            minute,
        });
        sendCmd("watering", "duration", {
            id,
            slot,
            duration_s: Math.round(durationMinutes * 60),
        });
    } else if (action === "slot-copy") {
        const slotEl = actionEl.closest("[data-watering-slot]");
        const sourceSlot = Number(
            actionEl.dataset.slot || slotEl?.dataset.wateringSlot,
        );
        const targetSlot = Number(actionEl.dataset.targetSlot);
        if (!Number.isFinite(sourceSlot) || !Number.isFinite(targetSlot)) return;
        const sourceHour = Number(slotEl?.dataset.hour || 0);
        const sourceMinute = Number(slotEl?.dataset.minute || 0);
        const sourceDurationS = Math.max(
            0,
            Number(slotEl?.dataset.durationS || 0),
        );
        sendCmd("watering", "time", {
            id,
            slot: targetSlot,
            hour: sourceHour,
            minute: sourceMinute,
        });
        sendCmd("watering", "duration", {
            id,
            slot: targetSlot,
            duration_s: sourceDurationS,
        });
    } else {
        return;
    }
    scheduleCommandRefresh(1500);
});

ui.deviceRingWrap?.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest('[data-action="ring-hold"]');
    if (!btn || !state.currentDevice || btn.disabled) return;
    const card = btn.closest(".ring-card");
    markTilePending(card, 900);
    sendCmd("ring", "hold", { state: "on" });
});

function releaseRingHold() {
    if (!state.currentDevice) return;
    sendCmd("ring", "hold", { state: "off" });
}

ui.deviceRingWrap?.addEventListener("pointerup", (e) => {
    if (!e.target.closest('[data-action="ring-hold"]')) return;
    releaseRingHold();
});
ui.deviceRingWrap?.addEventListener("pointerleave", (e) => {
    if (!e.target.closest('[data-action="ring-hold"]')) return;
    releaseRingHold();
});
ui.deviceRingWrap?.addEventListener("pointercancel", (e) => {
    if (!e.target.closest('[data-action="ring-hold"]')) return;
    releaseRingHold();
});

ui.deviceAvrWrap?.addEventListener("click", (e) => {
    const actionEl = e.target.closest("[data-action]");
    if (!actionEl || !state.currentDevice || actionEl.disabled) return;
    const tile =
        e.target.closest("[data-auto-mode]") ||
        ui.deviceAvrWrap.querySelector("[data-auto-mode]");
    const action = actionEl.dataset.action;
    if (action === "auto-toggle") {
        const autoMode = tile && tile.dataset.autoMode === "1";
        markTilePending(tile);
        sendCmd("avr", "auto", { state: autoMode ? "off" : "on" });
    } else if (action === "source") {
        const source = String(actionEl.dataset.source || "");
        if (!source) return;
        markTilePending(tile);
        sendCmd("avr", "source", { source });
    } else if (action === "clear-fault") {
        markTilePending(tile);
        sendCmd("avr", "clear_fault", {});
    } else {
        return;
    }
    scheduleCommandRefresh(1500);
});

ui.deviceLeakActions?.addEventListener("click", (e) => {
    const actionEl = e.target.closest("[data-action]");
    if (!actionEl || !state.currentDevice) return;
    if (actionEl.dataset.action !== "ack_all") return;
    markButtonPending(actionEl);
    sendCmd("leak", "ack_all", {});
    scheduleCommandRefresh(1500);
});

ui.deviceLeakGrid?.addEventListener("click", (e) => {
    const actionEl = e.target.closest("[data-action]");
    const tile = e.target.closest("[data-leak-id]");
    if (!actionEl || !tile || !state.currentDevice) return;
    if (tile.classList.contains("disabled")) return;
    const id = Number(tile.dataset.leakId);
    if (!Number.isFinite(id)) return;
    const action = actionEl.dataset.action;
    if (action === "power-toggle") {
        const powerOn = tile.dataset.powerOn === "1";
        markTilePending(tile);
        sendCmd("leak", "power", { id, state: powerOn ? "off" : "on" });
    } else if (action === "ack") {
        markTilePending(tile, 1000);
        sendCmd("leak", "ack", { id });
    } else {
        return;
    }
    scheduleCommandRefresh(1500);
});

function selectObject(name) {
    state.currentObject = name;
    ui.applyObjectTheme(name);
    ui.devicesObject.textContent = `Объект: ${name}`;
    requestDevices(name);
    ui.show("devices");
}

function selectDevice(device) {
    clearAllSocketPending();
    clearAllLightPending();
    clearStackPendingRetry();
    const isVirtual = Boolean(device?.virtual);
    if (isVirtual) {
        const masterDevice = (state.devicesRaw || []).find(
            (d) => Number(d?.device_id) === Number(device.master_device_id),
        );
        if (!masterDevice) {
            ui.setStatus("Мастер устройства недоступен", false);
            return;
        }
        selectDevice({
            ...masterDevice,
            preselectedTarget: {
                unit: "stack",
                node_id: Number(device.node_id),
            },
            openDirect: true,
        });
        return;
    }

    state.currentDevice = device;
    state.currentDeviceData = null;
    const preset = device.preselectedTarget;
    if (preset && preset.unit === "stack" && preset.node_id) {
        setCurrentTarget("stack", preset.node_id);
    } else if (preset && preset.unit === "local") {
        setCurrentTarget("local", null);
    } else if (!isVirtual) {
        // Selecting a master card in "Устройства онлайн" must force local target.
        setCurrentTarget("local", null);
    } else {
        const saved = state.targetByDevice[String(Number(device.device_id))];
        if (saved && saved.unit === "stack" && saved.node_id) {
            setCurrentTarget("stack", saved.node_id);
        } else {
            setCurrentTarget("local", null);
        }
    }

    ui.deviceStatusBody.innerHTML = "";
    ui.deviceControllersGrid.innerHTML = "";
    ui.deviceSocketsGrid.innerHTML = "";
    ui.deviceLightsGrid.innerHTML = "";
    ui.deviceTanksGrid.innerHTML = "";
    ui.deviceSecurityGrid.innerHTML = "";
    ui.deviceSecuritySummary.innerHTML = "";
    ui.deviceMeteoGrid.innerHTML = "";
    ui.deviceThermoGrid.innerHTML = "";
    ui.deviceSepticGrid.innerHTML = "";
    ui.deviceWateringGrid.innerHTML = "";
    ui.deviceRingWrap.innerHTML = "";
    ui.deviceAvrWrap.innerHTML = "";
    ui.deviceLeakGrid.innerHTML = "";
    ui.setContentLoading(true);
    ui.deviceWifiBody.innerHTML = "";
    ui.deviceGsmBody.innerHTML = "";
    ui.setDeviceNotice("");
    ui.setSocketsNotice("");
    ui.setLightsNotice("");
    ui.setTanksNotice("");
    ui.setSecurityNotice("");
    ui.setMeteoNotice("");
    ui.setThermoNotice("");
    ui.setSepticNotice("");
    ui.setWateringNotice("");
    ui.setRingNotice("");
    ui.setAvrNotice("");
    ui.setLeakNotice("");
    ui.setCamerasNotice("");
    renderTargetPicker(device);
    subscribeDevice(device.device_id);
    void bootstrapDeviceDetail(device);
    requestDeviceSnapshot();
    scheduleStackPendingRetry(state.currentDeviceData);
    startDevicePolling();
    ui.show("device");
}

async function bootstrapDeviceDetail(device) {
    const deviceId = Number(device?.device_id || 0);
    if (!deviceId) return;
    try {
        const data = await api(`/api/device/${deviceId}`);
        if (
            !state.currentDevice ||
            Number(state.currentDevice.device_id) !== deviceId ||
            !data?.device
        ) {
            return;
        }
        state.currentDeviceData = mergeDeviceData(state.currentDeviceData, data.device);
        renderTargetPicker(state.currentDeviceData);
        const effectiveDetail = applyPendingDeviceOverlay(state.currentDeviceData);
        const scopedDetail = resolveScopedDetail(effectiveDetail);
        ui.setContentLoading(false);
        ui.renderDevice(scopedDetail);
        ui.renderCameras(effectiveDetail);
        ui.renderSockets(scopedDetail);
        syncSocketPendingUi();
        ui.renderLights(scopedDetail);
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
    } catch (err) {
        // Keep websocket-driven flow if bootstrap detail is temporarily unavailable.
    }
}

async function requestDevices(objectName) {
    const requestId = ++devicesRequestSeq;
    ws.send({ type: "list_devices", object_name: objectName });
    try {
        const data = await api(
            `/api/devices?object=${encodeURIComponent(objectName)}`,
        );
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
    ws.send({ type: "subscribe_device", device_id: deviceId });
}

function unsubscribeDevice(deviceId) {
    ws.send({ type: "unsubscribe_device", device_id: deviceId });
}

function sendGet(what, unit = "local", nodeId = null) {
    if (!state.currentDevice) return;
    return ws.send({
        type: "send_get",
        device_id: state.currentDevice.device_id,
        what,
        unit,
        node_id: nodeId || undefined,
    });
}

function sendCmd(
    controller,
    action,
    args = {},
    unit = state.currentUnit,
    nodeId = state.currentNodeId,
) {
    if (!state.currentDevice) return;
    return ws.send({
        type: "send_cmd",
        device_id: state.currentDevice.device_id,
        controller,
        action,
        args,
        unit,
        node_id: nodeId || undefined,
    });
}

function lightScopeKey(
    lightId,
    unit = state.currentUnit,
    nodeId = state.currentNodeId,
    deviceId = state.currentDevice?.device_id,
) {
    const scopedUnit = unit === "stack" ? "stack" : "local";
    const scopedNodeId = scopedUnit === "stack" ? Number(nodeId || 0) : 0;
    return `${Number(deviceId || 0)}:${scopedUnit}:${scopedNodeId}:${Number(lightId)}`;
}

function socketScopeKey(
    socketId,
    unit = state.currentUnit,
    nodeId = state.currentNodeId,
    deviceId = state.currentDevice?.device_id,
) {
    const scopedUnit = unit === "stack" ? "stack" : "local";
    const scopedNodeId = scopedUnit === "stack" ? Number(nodeId || 0) : 0;
    return `${Number(deviceId || 0)}:${scopedUnit}:${scopedNodeId}:${Number(socketId)}`;
}

function beginSocketPending(socketId, expectedState) {
    if (!state.currentDevice) return null;
    const key = socketScopeKey(socketId);
    clearSocketPending(key);
    socketPendingOps.set(key, {
        key,
        deviceId: Number(state.currentDevice.device_id),
        unit: state.currentUnit === "stack" ? "stack" : "local",
        nodeId:
            state.currentUnit === "stack"
                ? Number(state.currentNodeId || 0)
                : 0,
        socketId: Number(socketId),
        expectedState: Boolean(expectedState),
        attempts: 0,
        timer: null,
    });
    syncSocketPendingUi();
    return key;
}

function clearSocketPending(key) {
    const op = socketPendingOps.get(key);
    if (!op) return;
    if (op.timer) {
        clearTimeout(op.timer);
    }
    socketPendingOps.delete(key);
}

function clearSocketPendingByScope(
    deviceId = state.currentDevice?.device_id,
    unit = state.currentUnit,
    nodeId = state.currentNodeId,
) {
    const prefix = `${Number(deviceId || 0)}:${unit === "stack" ? "stack" : "local"}:${unit === "stack" ? Number(nodeId || 0) : 0}:`;
    for (const key of [...socketPendingOps.keys()]) {
        if (!key.startsWith(prefix)) continue;
        clearSocketPending(key);
    }
    syncSocketPendingUi();
}

function clearAllSocketPending() {
    for (const key of [...socketPendingOps.keys()]) {
        clearSocketPending(key);
    }
    syncSocketPendingUi();
}

function beginLightPending(lightId, expectedState) {
    if (!state.currentDevice) return;
    const key = lightScopeKey(lightId);
    clearLightPending(key);
    lightPendingOps.set(key, {
        key,
        deviceId: Number(state.currentDevice.device_id),
        unit: state.currentUnit === "stack" ? "stack" : "local",
        nodeId:
            state.currentUnit === "stack"
                ? Number(state.currentNodeId || 0)
                : 0,
        lightId: Number(lightId),
        expectedState: Boolean(expectedState),
        attempts: 0,
        timer: null,
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

function clearLightPendingByScope(
    deviceId = state.currentDevice?.device_id,
    unit = state.currentUnit,
    nodeId = state.currentNodeId,
) {
    const prefix = `${Number(deviceId || 0)}:${unit === "stack" ? "stack" : "local"}:${unit === "stack" ? Number(nodeId || 0) : 0}:`;
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

function syncSocketPendingUi() {
    if (!ui.deviceSocketsGrid) return;
    if (!state.currentDevice) return;
    const currentDeviceId = Number(state.currentDevice.device_id);
    const currentUnit = state.currentUnit === "stack" ? "stack" : "local";
    const currentNodeId =
        currentUnit === "stack" ? Number(state.currentNodeId || 0) : 0;
    const pendingIds = new Set();
    for (const op of socketPendingOps.values()) {
        if (Number(op.deviceId) !== currentDeviceId) continue;
        if (op.unit !== currentUnit) continue;
        if (Number(op.nodeId || 0) !== currentNodeId) continue;
        pendingIds.add(Number(op.socketId));
    }
    const tiles = ui.deviceSocketsGrid.querySelectorAll("[data-socket-id]");
    tiles.forEach((tile) => {
        const id = Number(tile.dataset.socketId);
        const isPending = pendingIds.has(id);
        tile.classList.toggle("pending", isPending);
        tile.setAttribute("aria-busy", isPending ? "true" : "false");
    });
}

function scheduleCommandRefresh(delayMs = 1200) {
    if (commandRefreshTimer) {
        clearTimeout(commandRefreshTimer);
        commandRefreshTimer = null;
    }
    commandRefreshTimer = setTimeout(() => {
        commandRefreshTimer = null;
        requestDeviceSnapshot({ loading: false });
    }, Math.max(250, Number(delayMs) || 1200));
}

function triggerSocketPoll(key, delayMs = SOCKET_POLL_INTERVAL_MS) {
    const op = socketPendingOps.get(key);
    if (!op) return;
    if (op.timer) {
        clearTimeout(op.timer);
    }
    op.timer = setTimeout(() => {
        const active = socketPendingOps.get(key);
        if (
            !active ||
            !state.currentDevice ||
            Number(state.currentDevice.device_id) !== Number(active.deviceId)
        ) {
            clearSocketPending(key);
            return;
        }
        if (active.attempts >= SOCKET_POLL_MAX_ATTEMPTS) {
            clearSocketPending(key);
            syncSocketPendingUi();
            return;
        }
        active.attempts += 1;
        const now = Date.now();
        if (now - lastSocketPollSentMs >= SOCKET_POLL_MIN_SEND_GAP_MS) {
            lastSocketPollSentMs = now;
            requestDeviceSnapshot({ loading: false });
        }
        triggerSocketPoll(key, SOCKET_POLL_INTERVAL_MS);
    }, delayMs);
}

function patchSocketState(detail, socketId, nextState) {
    return patchControllerState(detail, "sockets", socketId, nextState);
}

function patchLightState(detail, lightId, nextState) {
    return patchControllerState(detail, "lights", lightId, nextState);
}

function patchControllerState(detail, controllerKey, itemId, nextState) {
    if (!detail || typeof detail !== "object") return detail;
    const patchList = (list) =>
        Array.isArray(list)
            ? list.map((item) =>
                  Number(item?.id) === Number(itemId)
                      ? {
                            ...item,
                            state: Boolean(nextState),
                            relay_on: Boolean(nextState),
                        }
                      : item,
              )
            : list;

    if (state.currentUnit === "stack" && state.currentNodeId) {
        const key = String(Number(state.currentNodeId));
        const scoped = detail?.stack_units?.[key];
        if (!scoped || typeof scoped !== "object") return detail;
        return {
            ...detail,
            stack_units: {
                ...(detail.stack_units || {}),
                [key]: {
                    ...scoped,
                    controllers: {
                        ...(scoped.controllers || {}),
                        [controllerKey]: patchList(
                            scoped.controllers?.[controllerKey],
                        ),
                    },
                },
            },
        };
    }

    return {
        ...detail,
        controllers: {
            ...(detail.controllers || {}),
            [controllerKey]: patchList(detail.controllers?.[controllerKey]),
        },
    };
}

function pendingScopeMatches(op) {
    const currentUnit = state.currentUnit === "stack" ? "stack" : "local";
    const currentNodeId =
        currentUnit === "stack" ? Number(state.currentNodeId || 0) : 0;
    return (
        Number(op?.deviceId || 0) === Number(state.currentDevice?.device_id || 0) &&
        op?.unit === currentUnit &&
        Number(op?.nodeId || 0) === currentNodeId
    );
}

function applyPendingDeviceOverlay(detail) {
    if (!detail || typeof detail !== "object" || !state.currentDevice) {
        return detail;
    }
    let next = detail;
    for (const op of socketPendingOps.values()) {
        if (!pendingScopeMatches(op)) continue;
        next = patchSocketState(next, op.socketId, op.expectedState);
    }
    for (const op of lightPendingOps.values()) {
        if (!pendingScopeMatches(op)) continue;
        next = patchLightState(next, op.lightId, op.expectedState);
    }
    return next;
}

function resolveSocketState(detail, socketId) {
    const scoped = resolveScopedDetail(detail);
    const sockets = Array.isArray(scoped?.controllers?.sockets)
        ? scoped.controllers.sockets
        : [];
    const match = sockets.find((item) => Number(item?.id) === Number(socketId));
    if (!match) return null;
    const raw = match.state ?? match.relay_on;
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    if (typeof raw === "string") {
        const v = raw.trim().toLowerCase();
        if (v === "1" || v === "on" || v === "true" || v === "yes") return true;
        if (v === "0" || v === "off" || v === "false" || v === "no" || v === "")
            return false;
    }
    return Boolean(raw);
}

function triggerLightPoll(key, delayMs = LIGHT_POLL_INTERVAL_MS) {
    const op = lightPendingOps.get(key);
    if (!op) return;
    if (op.timer) {
        clearTimeout(op.timer);
    }
    op.timer = setTimeout(() => {
        const active = lightPendingOps.get(key);
        if (
            !active ||
            !state.currentDevice ||
            Number(state.currentDevice.device_id) !== Number(active.deviceId)
        ) {
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
    const currentUnit = state.currentUnit === "stack" ? "stack" : "local";
    const currentNodeId =
        currentUnit === "stack" ? Number(state.currentNodeId || 0) : 0;
    const pendingIds = new Set();
    for (const op of lightPendingOps.values()) {
        if (Number(op.deviceId) !== currentDeviceId) continue;
        if (op.unit !== currentUnit) continue;
        if (Number(op.nodeId || 0) !== currentNodeId) continue;
        pendingIds.add(Number(op.lightId));
    }
    const tiles = ui.deviceLightsGrid.querySelectorAll("[data-light-id]");
    tiles.forEach((tile) => {
        const id = Number(tile.dataset.lightId);
        const isPending = pendingIds.has(id);
        const btn = tile.querySelector('[data-action="toggle"]');
        if (!btn) return;
        if (isPending) {
            btn.disabled = true;
            return;
        }
        if (!tile.classList.contains("disabled")) {
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
    if (state.currentUnit === "stack" && state.currentNodeId) {
        sendGet(["system", "controllers"], "stack", state.currentNodeId);
        return;
    }
    sendGet(["system", "controllers", "stack", "authz"], "local");
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
        last_event: next.last_event ?? prev.last_event,
    };
}

function mergeScopedGetResult(prev, msg) {
    if (!msg || typeof msg !== "object") return prev;
    const unit = msg.unit === "stack" ? "stack" : "local";
    const data =
        msg.data && typeof msg.data === "object" ? msg.data : {};
    const base =
        prev ||
        state.currentDeviceData ||
        state.currentDevice ||
        {};
    if (unit !== "stack") {
        return mergeDeviceData(base, data);
    }
    const nodeId = Number(msg.node_id || 0);
    if (!nodeId) return base;
    const key = String(nodeId);
    const nextStackUnits = {
        ...(base.stack_units && typeof base.stack_units === "object"
            ? base.stack_units
            : {}),
    };
    const patchUnit =
        data.stack_units &&
        typeof data.stack_units === "object" &&
        data.stack_units[key] &&
        typeof data.stack_units[key] === "object"
            ? data.stack_units[key]
            : {
                  ...(data.system && typeof data.system === "object"
                      ? { system: data.system }
                      : {}),
                  ...(data.controllers && typeof data.controllers === "object"
                      ? { controllers: data.controllers }
                      : {}),
                  ...(data.last_event ? { last_event: data.last_event } : {}),
              };
    const prevUnit =
        nextStackUnits[key] && typeof nextStackUnits[key] === "object"
            ? nextStackUnits[key]
            : {};
    nextStackUnits[key] = {
        ...prevUnit,
        ...patchUnit,
        system:
            patchUnit.system && typeof patchUnit.system === "object"
                ? {
                      ...((prevUnit.system && typeof prevUnit.system === "object"
                          ? prevUnit.system
                          : {})),
                      ...patchUnit.system,
                  }
                : prevUnit.system || {},
        controllers:
            patchUnit.controllers && typeof patchUnit.controllers === "object"
                ? {
                      ...((prevUnit.controllers &&
                      typeof prevUnit.controllers === "object"
                          ? prevUnit.controllers
                          : {})),
                      ...patchUnit.controllers,
                  }
                : prevUnit.controllers || {},
    };
    return mergeDeviceData(base, {
        ...(data.stack
            ? { stack: data.stack }
            : base.stack
              ? { stack: base.stack }
              : {}),
        stack_units: nextStackUnits,
    });
}

function resolveScopedDetail(detail) {
    if (!detail) return detail;
    if (state.currentUnit !== "stack" || !state.currentNodeId) {
        return detail;
    }
    const map = detail.stack_units;
    const key = String(Number(state.currentNodeId));
    const scoped = map && typeof map === "object" ? map[key] : null;
    const node = Array.isArray(detail?.stack?.nodes)
        ? detail.stack.nodes.find(
              (item) => Number(item?.node_id) === Number(state.currentNodeId),
          )
        : null;
    if (!scoped || typeof scoped !== "object") {
        return {
            ...detail,
            name: node?.name || detail.name,
            scope_unit: "stack",
            scope_node_id: Number(state.currentNodeId) || 0,
            online:
                typeof node?.online === "boolean"
                    ? Boolean(node.online)
                    : detail.online,
            system: {},
            controllers: {},
        };
    }
    return {
        ...detail,
        name: node?.name || scoped.name || detail.name,
        scope_unit: "stack",
        scope_node_id: Number(state.currentNodeId) || 0,
        online:
            typeof node?.online === "boolean"
                ? Boolean(node.online)
                : typeof scoped.online === "boolean"
                  ? Boolean(scoped.online)
                  : detail.online,
        system: scoped.system || {},
        controllers: scoped.controllers || {},
        summary:
            scoped.summary && typeof scoped.summary === "object"
                ? scoped.summary
                : detail.summary && typeof detail.summary === "object"
                  ? detail.summary
                  : null,
        last_event: scoped.last_event ?? detail.last_event,
    };
}

function resolveLightState(detail, lightId) {
    const scoped = resolveScopedDetail(detail);
    const lights = Array.isArray(scoped?.controllers?.lights)
        ? scoped.controllers.lights
        : [];
    const match = lights.find((item) => Number(item?.id) === Number(lightId));
    if (!match) return null;
    const raw = match.state ?? match.relay_on;
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    if (typeof raw === "string") {
        const v = raw.trim().toLowerCase();
        if (v === "1" || v === "on" || v === "true" || v === "yes") return true;
        if (v === "0" || v === "off" || v === "false" || v === "no" || v === "")
            return false;
    }
    return Boolean(raw);
}

function reconcileSocketPending(detail) {
    if (!state.currentDevice) return;
    const currentDeviceId = Number(state.currentDevice.device_id);
    const currentUnit = state.currentUnit === "stack" ? "stack" : "local";
    const currentNodeId =
        currentUnit === "stack" ? Number(state.currentNodeId || 0) : 0;
    const keysToClear = [];
    for (const [key, op] of socketPendingOps.entries()) {
        if (Number(op.deviceId) !== currentDeviceId) continue;
        if (op.unit !== currentUnit) continue;
        if (Number(op.nodeId || 0) !== currentNodeId) continue;
        const current = resolveSocketState(detail, op.socketId);
        if (current === null) continue;
        if (current === Boolean(op.expectedState)) {
            keysToClear.push(key);
        }
    }
    if (!keysToClear.length) return;
    for (const key of keysToClear) {
        clearSocketPending(key);
    }
    syncSocketPendingUi();
}

function reconcileLightPending(detail) {
    if (!state.currentDevice) return;
    const currentDeviceId = Number(state.currentDevice.device_id);
    const currentUnit = state.currentUnit === "stack" ? "stack" : "local";
    const currentNodeId =
        currentUnit === "stack" ? Number(state.currentNodeId || 0) : 0;
    const keysToClear = [];
    for (const [key, op] of lightPendingOps.entries()) {
        if (Number(op.deviceId) !== currentDeviceId) continue;
        if (op.unit !== currentUnit) continue;
        if (Number(op.nodeId || 0) !== currentNodeId) continue;
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
    if (
        msg.type === "devices_update" &&
        msg.object_name === state.currentObject
    ) {
        state.devicesRaw = msg.devices || [];
        state.devices = expandDevicesWithVirtual(state.devicesRaw);
        ui.renderDevices(selectDevice);
        return;
    }

    if (
        msg.type === "get_result" &&
        state.currentDevice &&
        Number(msg.device_id) === Number(state.currentDevice.device_id)
    ) {
        ui.setContentLoading(false);
        state.currentDeviceData = mergeScopedGetResult(
            state.currentDeviceData,
            msg,
        );
        renderTargetPicker(state.currentDeviceData);
        scheduleStackPendingRetry(state.currentDeviceData);
        reconcileSocketPending(state.currentDeviceData);
        reconcileLightPending(state.currentDeviceData);
        const effectiveDetail = applyPendingDeviceOverlay(
            state.currentDeviceData,
        );
        const scopedDetail = resolveScopedDetail(effectiveDetail);
        ui.renderDevice(scopedDetail);
        ui.renderCameras(effectiveDetail);
        ui.renderSockets(scopedDetail);
        syncSocketPendingUi();
        ui.renderLights(scopedDetail);
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

    if (
        msg.type === "device_update" &&
        state.currentDevice &&
        Number(msg.device?.device_id) === Number(state.currentDevice.device_id)
    ) {
        ui.setContentLoading(false);
        state.currentDeviceData = mergeDeviceData(
            state.currentDeviceData,
            msg.device,
        );
        renderTargetPicker(state.currentDeviceData);
        scheduleStackPendingRetry(state.currentDeviceData);
        reconcileSocketPending(state.currentDeviceData);
        reconcileLightPending(state.currentDeviceData);
        const scopedDetailRaw = resolveScopedDetail(state.currentDeviceData);
        maybeShowEventToast(scopedDetailRaw);
        const effectiveDetail = applyPendingDeviceOverlay(
            state.currentDeviceData,
        );
        const scopedDetail = resolveScopedDetail(effectiveDetail);
        ui.renderDevice(scopedDetail);
        ui.renderCameras(effectiveDetail);
        ui.renderSockets(scopedDetail);
        syncSocketPendingUi();
        ui.renderLights(scopedDetail);
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

    if (
        msg.type === "device_offline" &&
        state.currentDevice &&
        Number(msg.device_id) === Number(state.currentDevice.device_id)
    ) {
        ui.setContentLoading(false);
        clearAllSocketPending();
        clearAllLightPending();
        ui.setDeviceNotice("Устройство оффлайн");
        ui.setSocketsNotice("Устройство оффлайн");
        ui.setLightsNotice("Устройство оффлайн");
        ui.setTanksNotice("Устройство оффлайн");
        ui.setSecurityNotice("Устройство оффлайн");
        ui.setMeteoNotice("Устройство оффлайн");
        ui.setThermoNotice("Устройство оффлайн");
        ui.setSepticNotice("Устройство оффлайн");
        ui.setWateringNotice("Устройство оффлайн");
        ui.setRingNotice("Устройство оффлайн");
        ui.setAvrNotice("Устройство оффлайн");
        ui.setLeakNotice("Устройство оффлайн");
        ui.setCamerasNotice("Устройство оффлайн");
    }

    if (
        (msg.type === "device_online" || msg.type === "device_offline") &&
        state.currentObject
    ) {
        requestDevices(state.currentObject);
    }

    if (
        msg.type === "devices_dirty" &&
        state.currentObject &&
        String(msg.object_name || "") === String(state.currentObject || "")
    ) {
        requestDevices(state.currentObject);
        if (
            state.currentDevice &&
            Number(msg.device_id) === Number(state.currentDevice.device_id)
        ) {
            requestDeviceSnapshot({ loading: false });
            scheduleStackPendingRetry(state.currentDeviceData);
        }
    }

    if (msg.type === "command_error") {
        const errorText = String(msg.error || "").trim();
        const errorLower = errorText.toLowerCase();
        const isCameraBusyWait =
            String(msg.controller || "") === "cameras" &&
            String(msg.action || "") === "snapshot" &&
            errorLower.includes("camera busy");
        if (isCameraBusyWait) {
            ui.setContentLoading(false);
            ui.setStatus("Снимок уже загружается, ждём обновление", true);
            ui.setCamerasNotice("Снимок уже загружается другим запросом, ждём обновление...");
            [500, 1500, 3000, 5000].forEach((delayMs) => {
                setTimeout(() => {
                    if (!state.currentDevice) return;
                    requestDeviceSnapshot({ loading: false });
                }, delayMs);
            });
            return;
        }
        ui.setContentLoading(false);
        clearStackPendingRetry();
        clearSocketPendingByScope();
        clearLightPendingByScope();
        ui.setStatus(`Ошибка запроса: ${errorText}`, false);
        ui.setDeviceNotice(`Ошибка запроса: ${errorText}`);
        ui.setSocketsNotice(`Ошибка команды: ${errorText}`);
        ui.setLightsNotice(`Ошибка команды: ${errorText}`);
        ui.setTanksNotice(`Ошибка команды: ${errorText}`);
        ui.setSecurityNotice(`Ошибка команды: ${errorText}`);
        ui.setThermoNotice(`Ошибка команды: ${errorText}`);
        ui.setSepticNotice(`Ошибка команды: ${errorText}`);
        ui.setWateringNotice(`Ошибка команды: ${errorText}`);
        ui.setRingNotice(`Ошибка команды: ${errorText}`);
        ui.setAvrNotice(`Ошибка команды: ${errorText}`);
        ui.setLeakNotice(`Ошибка команды: ${errorText}`);
        ui.setCamerasNotice(`Ошибка команды: ${errorText}`);
    }
}

checkAuth();
