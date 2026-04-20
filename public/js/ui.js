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
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function onOffDot(flag) {
    return `<span class="status-dot ${flag ? "status-on" : "status-off"}"></span>`;
}

function statusBadge(label, tone = "neutral") {
    const safeTone = String(tone || "neutral");
    return `
    <span class="status-badge status-badge-${safeTone}">
      <span class="status-badge-dot" aria-hidden="true"></span>
      <span>${esc(label)}</span>
    </span>
  `;
}

function summaryIndicator(label, value, tone = "neutral", hint = "") {
    const safeTone = String(tone || "neutral");
    const safeHint = hint ? `<span class="summary-indicator-hint">${esc(hint)}</span>` : "";
    return `
    <div class="summary-indicator summary-indicator-${safeTone}">
      <div class="summary-indicator-head">
        <span class="summary-indicator-dot" aria-hidden="true"></span>
        <span class="summary-indicator-label">${esc(label)}</span>
      </div>
      <div class="summary-indicator-value">${esc(value)}</div>
      ${safeHint}
    </div>
  `;
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function controllerAccess(detail, controllerKey, itemId = null, action = "") {
    const access = detail?.access?.controllers?.[controllerKey];
    if (!access) return { read: true, write: true };
    const allowedIds = Array.isArray(access.ids)
        ? access.ids.map(Number).filter(Number.isFinite)
        : null;
    const allowedActions = Array.isArray(access.actions)
        ? access.actions.map(String)
        : null;
    const idAllowed =
        itemId === null ||
        !allowedIds ||
        !allowedIds.length ||
        allowedIds.includes(Number(itemId));
    const actionAllowed =
        !action ||
        !allowedActions ||
        !allowedActions.length ||
        allowedActions.includes(String(action));
    return {
        read: Boolean(access.read),
        write: Boolean(access.write) && idAllowed && actionAllowed,
    };
}

function formatTemperature(value, digits = null) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    const text = digits === null ? String(num) : num.toFixed(digits);
    return `${text} &deg;C`;
}

function avrSourceLabel(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw || raw === "off") return "Выключен";
    if (raw === "main") return "Основной";
    if (raw === "reserve") return "Резерв";
    return String(value || "-");
}

function avrFaultLabel(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw || raw === "none") return "";
    if (raw === "no_source") return "Нет источника";
    if (raw === "transfer_timeout") return "Таймаут переключения";
    if (raw === "interlock") return "Блокировка";
    if (raw === "feedback_mismatch") return "Нет подтверждения";
    return String(value || "");
}

function avrStatusLabel(value) {
    if (!value || typeof value !== "object") return "-";
    const source = avrSourceLabel(value.active_source);
    const fault = avrFaultLabel(value.fault);
    return fault ? `${source} / ${fault}` : source;
}

function formatLastEvent(eventPayload) {
    if (!eventPayload || typeof eventPayload !== "object") return "—";
    const kind = String(eventPayload.kind || "event").trim() || "event";
    const reason = String(eventPayload.reason || "").trim();
    const unit = String(eventPayload.unit || "").trim().toLowerCase();
    const data =
        eventPayload.data && typeof eventPayload.data === "object"
            ? eventPayload.data
            : {};
    const pieces = [kind];
    if (reason) pieces.push(reason);
    const sourceName = String(data.source_name || "").trim();
    if (sourceName) {
        pieces.push(sourceName);
    } else if (unit === "stack") {
        const unitName = String(data.unit_name || "").trim();
        const nodeId = Number(eventPayload.node_id || 0);
        pieces.push(unitName || (nodeId ? `stack #${nodeId}` : "stack"));
    }
    if (data.name) pieces.push(String(data.name));
    if (typeof data.state === "boolean") pieces.push(data.state ? "on" : "off");
    if (typeof data.alarm === "boolean") pieces.push(data.alarm ? "alarm" : "ok");
    if (typeof data.empty === "boolean" && data.empty) pieces.push("empty");
    return pieces.map((item) => esc(item)).join(" · ");
}

function wateringWeekdaysMask(item) {
    const mask = Number(item?.weekdays_mask);
    if (!Number.isFinite(mask)) return 0;
    return mask & 0x7f;
}

function wateringWeekdayList(mask) {
    const days = [
        { bit: 1, label: "Пн" },
        { bit: 2, label: "Вт" },
        { bit: 3, label: "Ср" },
        { bit: 4, label: "Чт" },
        { bit: 5, label: "Пт" },
        { bit: 6, label: "Сб" },
        { bit: 0, label: "Вс" },
    ];
    return days.filter((day) => (mask & (1 << day.bit)) !== 0).map((day) => day.label);
}

function wateringTimeLabel(hour, minute) {
    const h = Number(hour);
    const m = Number(minute);
    if (
        !Number.isInteger(h) ||
        !Number.isInteger(m) ||
        h < 0 ||
        h > 23 ||
        m < 0 ||
        m > 59
    ) {
        return "--:--";
    }
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function wateringDurationLabel(seconds) {
    const num = Number(seconds);
    if (!Number.isFinite(num) || num <= 0) return "—";
    return `${Math.round(num / 60)} мин`;
}

function wateringSlotConfigured(slot) {
    const enabled = Boolean(slot?.enabled);
    if (!enabled) return false;
    const hour = Number(slot?.hour);
    const minute = Number(slot?.minute);
    const durationS = Number(slot?.duration_s);
    return (
        Number.isFinite(hour) &&
        Number.isFinite(minute) &&
        hour >= 0 &&
        hour <= 23 &&
        minute >= 0 &&
        minute <= 59 &&
        Number.isFinite(durationS) &&
        durationS > 0
    );
}

const OBJECT_ICON_OPTIONS = [
    { value: "apartment", label: "Квартира" },
    { value: "house", label: "Частный дом" },
    { value: "dacha", label: "Дача" },
    { value: "garage", label: "Гараж" },
    { value: "garden", label: "Сад" },
];

function normalizeObjectItem(raw) {
    if (typeof raw === "string") {
        return { name: raw, icon: "house" };
    }
    return {
        name: String(raw?.name || ""),
        icon: String(raw?.icon || "house"),
    };
}

function objectIconSvg(icon) {
    const kind = String(icon || "house").toLowerCase();
    if (kind === "apartment") {
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
    if (kind === "dacha") {
        return `
      <svg class="object-icon" viewBox="0 0 64 64" aria-hidden="true">
        <path fill="currentColor" d="M8 30 32 10l24 20v24H8V30zm6 2v16h36V32L32 17 14 32z"/>
        <rect x="28" y="34" width="8" height="14" fill="currentColor"/>
        <path fill="currentColor" d="M48 14h4l4 8h-4z"/>
      </svg>
    `;
    }
    if (kind === "garage") {
        return `
      <svg class="object-icon" viewBox="0 0 64 64" aria-hidden="true">
        <path fill="currentColor" d="M6 30 32 12l26 18v24H6V30zm6 2v16h40V32L32 18 12 32z"/>
        <rect x="20" y="34" width="24" height="14" fill="currentColor"/>
        <path fill="#0b1220" d="M22 38h20v2H22zm0 4h20v2H22z"/>
      </svg>
    `;
    }
    if (kind === "garden") {
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

function summarizeControllers(controllers = {}, summary = null, options = {}) {
    const preferKeyPresence = Boolean(options?.preferKeyPresence);
    const summaryObj = (value) =>
        !Array.isArray(value) && value && typeof value === "object" ? value : null;
    const hasControllerData = (items, summaryValue, primary = "enabled_count", alt = "enabled") =>
        items.length > 0 ||
        countOf(summaryValue, primary, alt) > 0 ||
        (preferKeyPresence && Boolean(summaryValue));
    const rootSummary =
        summary && typeof summary === "object" ? summary : null;
    const effectiveControllers = {
        ...(rootSummary || {}),
        ...(controllers && typeof controllers === "object" ? controllers : {}),
    };
    const sockets = asArray(effectiveControllers.sockets);
    const lights = asArray(effectiveControllers.lights);
    const meteo = asArray(effectiveControllers.meteo);
    const cameras = asArray(effectiveControllers.cameras);
    const thermo = asArray(effectiveControllers.thermo);
    const tanks = asArray(effectiveControllers.tanks);
    const septic = asArray(effectiveControllers.septic);
    const watering = asArray(effectiveControllers.watering);
    const rules = asArray(effectiveControllers.rules);
    const leak = asArray(effectiveControllers.leak);
    const countOf = (obj, primary, alt) => {
        const raw = obj?.[primary] ?? obj?.[alt];
        const num = Number(raw);
        return Number.isFinite(num) ? num : 0;
    };
    const socketsSummary = summaryObj(effectiveControllers.sockets);
    const lightsSummary = summaryObj(effectiveControllers.lights);
    const meteoSummary = summaryObj(effectiveControllers.meteo);
    const camerasSummary = summaryObj(effectiveControllers.cameras);
    const thermoSummary = summaryObj(effectiveControllers.thermo);
    const tanksSummary = summaryObj(effectiveControllers.tanks);
    const septicSummary = summaryObj(effectiveControllers.septic);
    const wateringSummary = summaryObj(effectiveControllers.watering);
    const rulesSummary = summaryObj(effectiveControllers.rules);
    const leakSummary = summaryObj(effectiveControllers.leak);

    return [
        {
            key: "sockets",
            title: "Розетки",
            status: sockets.length > 0
                ? `${sockets.filter((x) => x.state).length}/${sockets.length}`
                : `${countOf(socketsSummary, "on_count", "on")}/${countOf(socketsSummary, "enabled_count", "enabled")}`,
            online: hasControllerData(sockets, socketsSummary),
            visible: hasControllerData(sockets, socketsSummary),
        },
        {
            key: "lights",
            title: "Освещение",
            status: lights.length > 0
                ? `${lights.filter((x) => x.state).length}/${lights.length}`
                : `${countOf(lightsSummary, "on_count", "on")}/${countOf(lightsSummary, "enabled_count", "enabled")}`,
            online: hasControllerData(lights, lightsSummary),
            visible: hasControllerData(lights, lightsSummary),
        },
        {
            key: "meteo",
            title: "Метео",
            status: meteo.length > 0
                ? `${meteo.filter((x) => x.ok).length}/${meteo.length}`
                : `${countOf(meteoSummary, "ok_count", "ok")}/${countOf(meteoSummary, "enabled_count", "enabled")}`,
            online: hasControllerData(meteo, meteoSummary),
            visible: hasControllerData(meteo, meteoSummary),
        },
        {
            key: "cameras",
            title: "Камеры",
            status: cameras.length > 0
                ? `${cameras.filter((x) => x.enabled).length}/${cameras.length}`
                : `${countOf(camerasSummary, "enabled_count", "enabled")}/${countOf(camerasSummary, "count", "total")}`,
            online: hasControllerData(cameras, camerasSummary),
            visible: hasControllerData(cameras, camerasSummary),
        },
        {
            key: "thermo",
            title: "Термостаты",
            status: thermo.length > 0
                ? `${thermo.filter((x) => x.heat_on || x.cool_on).length}/${thermo.length}`
                : `${countOf(thermoSummary, "active_count", "active")}/${countOf(thermoSummary, "enabled_count", "enabled")}`,
            online: hasControllerData(thermo, thermoSummary),
            visible: hasControllerData(thermo, thermoSummary),
        },
        {
            key: "tanks",
            title: "Баки",
            status: tanks.length > 0
                ? `${tanks.filter((x) => x.pump_on || x.alarm_on).length}/${tanks.length}`
                : `${countOf(tanksSummary, "alert_count", "alert")}/${countOf(tanksSummary, "enabled_count", "enabled")}`,
            online: hasControllerData(tanks, tanksSummary),
            visible: hasControllerData(tanks, tanksSummary),
        },
        {
            key: "septic",
            title: "Септик",
            status: septic.length > 0
                ? `${septic.filter((x) => x.warning || x.alarm).length}/${septic.length}`
                : `${countOf(septicSummary, "alert_count", "alert")}/${countOf(septicSummary, "enabled_count", "enabled")}`,
            online: hasControllerData(septic, septicSummary),
            visible: hasControllerData(septic, septicSummary),
        },
        {
            key: "watering",
            title: "Полив",
            status: watering.length > 0
                ? `${watering.filter((x) => x.active).length}/${watering.length}`
                : `${countOf(wateringSummary, "active_count", "active")}/${countOf(wateringSummary, "enabled_count", "enabled")}`,
            online: hasControllerData(watering, wateringSummary),
            visible: hasControllerData(watering, wateringSummary),
        },
        {
            key: "rules",
            title: "Правила",
            status: rules.length > 0
                ? `${rules.length}`
                : `${countOf(rulesSummary, "enabled_count", "enabled")}`,
            online: hasControllerData(rules, rulesSummary),
            visible: hasControllerData(rules, rulesSummary),
        },
        {
            key: "security",
            title: "Охрана",
            status: effectiveControllers.security
                ? effectiveControllers.security.alarm
                    ? "Тревога"
                    : effectiveControllers.security.armed
                      ? "На охране"
                      : "Снято"
                : "-",
            online: Boolean(effectiveControllers.security?.enabled) || (preferKeyPresence && Boolean(effectiveControllers.security)),
            visible: Boolean(effectiveControllers.security?.enabled) || (preferKeyPresence && Boolean(effectiveControllers.security)),
        },
        {
            key: "ring",
            title: "Звонок",
            status: effectiveControllers.ring
                ? effectiveControllers.ring.relay_on
                    ? "Включен"
                    : "Выключен"
                : "-",
            online: Boolean(effectiveControllers.ring?.enabled) || (preferKeyPresence && Boolean(effectiveControllers.ring)),
            visible: Boolean(effectiveControllers.ring?.enabled) || (preferKeyPresence && Boolean(effectiveControllers.ring)),
        },
        {
            key: "avr",
            title: "АВР",
            status: avrStatusLabel(effectiveControllers.avr),
            online: Boolean(effectiveControllers.avr?.enabled) || (preferKeyPresence && Boolean(effectiveControllers.avr)),
            visible: Boolean(effectiveControllers.avr?.enabled) || (preferKeyPresence && Boolean(effectiveControllers.avr)),
        },
        {
            key: "leak",
            title: "Протечки",
            status: leak.length > 0
                ? `${leak.filter((x) => x.wet || x.alarm_latched).length}/${leak.length}`
                : `${countOf(leakSummary, "alert_count", "alert")}/${countOf(leakSummary, "enabled_count", "enabled")}`,
            online: hasControllerData(leak, leakSummary),
            visible: hasControllerData(leak, leakSummary),
        },
    ].filter((card) => card.visible);
}

function stackControllerPending(detail, key, primary = "enabled_count", alt = "enabled") {
    if (!(detail?.scope_unit === "stack" && Number(detail?.scope_node_id || 0) > 0)) {
        return false;
    }
    const section = detail?.controllers?.[key];
    if (Array.isArray(section) && section.length > 0) {
        return false;
    }
    const summary =
        detail?.summary && typeof detail.summary === "object"
            ? detail.summary
            : detail?.system?.summary &&
                typeof detail.system.summary === "object"
              ? detail.system.summary
              : null;
    const value = summary?.[key];
    if (!value || typeof value !== "object") {
        return false;
    }
    const raw = value?.[primary] ?? value?.[alt];
    const num = Number(raw);
    return Number.isFinite(num) ? num > 0 : true;
}

function controllerIconSvg(key) {
    const k = String(key || "").toLowerCase();
    if (k === "lights") {
        return '<svg class="ctrl-icon-svg" viewBox="0 0 96 96" fill="none" aria-hidden="true"><path d="M48 14c-14.4 0-26 11.6-26 26 0 10 5.6 18.7 13.9 23.1 2.6 1.4 4.1 4 4.1 6.9V72h16v-2c0-2.9 1.5-5.5 4.1-6.9C68.4 58.7 74 50 74 40c0-14.4-11.6-26-26-26Z" stroke="currentColor" stroke-width="5"/><path d="M38 78h20M40 84h16" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M40 46c2.5-4 5.2-6 8-6s5.5 2 8 6" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';
    }
    if (k === "sockets") {
        return '<svg class="ctrl-icon-svg" viewBox="0 0 96 96" fill="none" aria-hidden="true"><rect x="18" y="12" width="60" height="72" rx="18" stroke="currentColor" stroke-width="5"/><circle cx="36" cy="36" r="6" fill="currentColor"/><circle cx="60" cy="36" r="6" fill="currentColor"/><rect x="41" y="54" width="14" height="20" rx="5" fill="currentColor"/></svg>';
    }
    if (k === "security") {
        return '<svg class="ctrl-icon-svg" viewBox="0 0 96 96" fill="none" aria-hidden="true"><path d="M48 12 22 22v22c0 18 10.7 30.8 26 39 15.3-8.2 26-21 26-39V22L48 12Z" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/><rect x="38" y="40" width="20" height="18" rx="4" stroke="currentColor" stroke-width="5"/><path d="M42 40v-6a6 6 0 1 1 12 0v6" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';
    }
    if (k === "meteo") {
        return '<svg class="ctrl-icon-svg" viewBox="0 0 96 96" fill="none" aria-hidden="true"><path d="M28 58c-7.7 0-14-6.3-14-14s6.3-14 14-14c2.2 0 4.2.5 6.1 1.4C37.5 24 44.1 20 52 20c11 0 20 9 20 20v1c6.6 1 12 6.7 12 13.6C84 62 77.9 68 70.4 68H28Z" stroke="currentColor" stroke-width="5"/><path d="M48 42v24" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><circle cx="48" cy="34" r="8" stroke="currentColor" stroke-width="5"/><path d="M62 72c0 5.5-4.5 10-10 10s-10-4.5-10-10c0-7 10-18 10-18s10 11 10 18Z" fill="currentColor" opacity=".45"/></svg>';
    }
    if (k === "cameras") {
        return '<svg class="ctrl-icon-svg" viewBox="0 0 96 96" fill="none" aria-hidden="true"><rect x="12" y="22" width="54" height="40" rx="10" stroke="currentColor" stroke-width="5"/><circle cx="39" cy="42" r="12" stroke="currentColor" stroke-width="5"/><path d="M66 34h10l8-6v28l-8-6H66z" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/><path d="M24 26l8-10h16l8 10" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    if (k === "thermo") {
        return '<svg class="ctrl-icon-svg" viewBox="0 0 96 96" fill="none" aria-hidden="true"><rect x="30" y="12" width="36" height="72" rx="18" stroke="currentColor" stroke-width="5"/><path d="M48 24v34" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><circle cx="48" cy="66" r="12" fill="currentColor"/><path d="M24 28h10M24 42h10M24 56h10" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';
    }
    if (k === "tanks") {
        return '<svg class="ctrl-icon-svg" viewBox="0 0 96 96" fill="none" aria-hidden="true"><rect x="22" y="14" width="52" height="68" rx="12" stroke="currentColor" stroke-width="5"/><path d="M30 56c8-4 28-4 36 0v14H30V56Z" fill="currentColor" opacity=".45"/><path d="M38 14v-6h20v6" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M30 44h36" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';
    }
    if (k === "septic") {
        return '<svg class="ctrl-icon-svg" viewBox="0 0 96 96" fill="none" aria-hidden="true"><rect x="18" y="18" width="60" height="50" rx="10" stroke="currentColor" stroke-width="5"/><path d="M18 52h60" stroke="currentColor" stroke-width="5"/><path d="M32 76h32" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M48 68v8" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M28 42c10-4 30-4 40 0" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';
    }
    if (k === "watering") {
        return '<svg class="ctrl-icon-svg" viewBox="0 0 96 96" fill="none" aria-hidden="true"><path d="M34 18h28" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><circle cx="34" cy="18" r="4" fill="currentColor"/><circle cx="62" cy="18" r="4" fill="currentColor"/><circle cx="48" cy="18" r="7" fill="currentColor"/><path d="M48 25v11" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M22 42h34c9 0 17 8 17 17v2c0 4-3 7-7 7h-8V57c0-4-3-7-7-7H22z" fill="currentColor"/><path d="M58 42h8c10 0 18 8 18 18v12h-8V61c0-6-5-11-11-11h-7z" fill="currentColor"/><path d="M70 72h14v4H70z" fill="currentColor"/><path d="M66 79c0 6.6-5.4 12-12 12s-12-5.4-12-12c0-7.6 12-20 12-20s12 12.4 12 20Z" fill="currentColor" opacity=".7"/><path d="M57 72c2 3 3 6 3 9 0 4.5-2.7 8-7 8" stroke="#0b1220" stroke-width="3" stroke-linecap="round" opacity=".55"/></svg>';
    }
    if (k === "rules") {
        return '<svg class="ctrl-icon-svg" viewBox="0 0 96 96" fill="none" aria-hidden="true"><rect x="22" y="14" width="52" height="68" rx="10" stroke="currentColor" stroke-width="5"/><path d="M34 32h28M34 46h28M34 60h20" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M58 56l8 8 14-18" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    if (k === "ring") {
        return '<svg class="ctrl-icon-svg" viewBox="0 0 96 96" fill="none" aria-hidden="true"><path d="M48 18c-12 0-22 10-22 22v11c0 7-2.8 13.7-7.8 18.7L14 74h68l-4.2-4.3C72.8 64.7 70 58 70 51V40c0-12-10-22-22-22Z" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/><path d="M40 80c2 4 4.8 6 8 6s6-2 8-6" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';
    }
    if (k === "avr") {
        return '<svg class="ctrl-icon-svg" viewBox="0 0 96 96" fill="none" aria-hidden="true"><path d="M54 10 28 52h18l-4 34 26-42H50l4-34Z" fill="currentColor"/><path d="M18 24h18M60 72h18" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';
    }
    if (k === "leak") {
        return '<svg class="ctrl-icon-svg" viewBox="0 0 96 96" fill="none" aria-hidden="true"><path d="M48 14c-10 14-24 29.1-24 43a24 24 0 0 0 48 0c0-13.9-14-29-24-43Z" stroke="currentColor" stroke-width="5"/><path d="M30 70c8-5 28-5 36 0" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><circle cx="48" cy="58" r="8" fill="currentColor" opacity=".45"/></svg>';
    }
    return '<svg class="ctrl-icon-svg" viewBox="0 0 96 96" fill="none" aria-hidden="true"><circle cx="48" cy="48" r="30" stroke="currentColor" stroke-width="5"/></svg>';
}

function thermoStatusVisualSvg(mode, heatOn, coolOn) {
    const normalized = String(mode || "").toLowerCase();
    const heatSvg =
        '<svg class="icon heat ' +
        (heatOn ? "active" : "inactive") +
        '" viewBox="0 0 120 120" aria-hidden="true"><rect x="22" y="30" width="76" height="60" rx="10"/><line x1="36" y1="40" x2="36" y2="80"/><line x1="52" y1="40" x2="52" y2="80"/><line x1="68" y1="40" x2="68" y2="80"/><line x1="84" y1="40" x2="84" y2="80"/></svg>';
    const coolSvg =
        '<svg class="icon cool ' +
        (coolOn ? "active" : "inactive") +
        '" viewBox="0 0 120 120" aria-hidden="true"><rect x="20" y="32" width="80" height="40" rx="10"/><line x1="32" y1="46" x2="88" y2="46"/><line x1="32" y1="58" x2="88" y2="58"/><line x1="44" y1="78" x2="38" y2="92"/><line x1="60" y1="78" x2="60" y2="94"/><line x1="76" y1="78" x2="82" y2="92"/></svg>';
    if (normalized === "heat" || normalized === "heat_only") return heatSvg;
    if (normalized === "cool" || normalized === "cool_only") return coolSvg;
    if (normalized === "off") return "";
    return `${heatSvg}${coolSvg}`;
}

export class Ui {
    constructor({ state }) {
        this.state = state;

        this.loginView = document.getElementById("loginView");
        this.objectsView = document.getElementById("objectsView");
        this.settingsView = document.getElementById("settingsView");
        this.settingsHomePanel = document.getElementById("settingsHomePanel");
        this.settingsObjectsPanel = document.getElementById(
            "settingsObjectsPanel",
        );
        this.settingsDevicesPanel = document.getElementById(
            "settingsDevicesPanel",
        );
        this.settingsUsersPanel = document.getElementById("settingsUsersPanel");
        this.settingsTelegramPanel = document.getElementById(
            "settingsTelegramPanel",
        );
        this.devicesView = document.getElementById("devicesView");
        this.deviceView = document.getElementById("deviceView");
        this.deviceControllersView = document.getElementById(
            "deviceControllersView",
        );
        this.deviceCamerasView = document.getElementById("deviceCamerasView");
        this.deviceSocketsView = document.getElementById("deviceSocketsView");
        this.deviceLightsView = document.getElementById("deviceLightsView");
        this.deviceTanksView = document.getElementById("deviceTanksView");
        this.deviceSecurityView = document.getElementById("deviceSecurityView");
        this.deviceMeteoView = document.getElementById("deviceMeteoView");
        this.deviceThermoView = document.getElementById("deviceThermoView");
        this.deviceSepticView = document.getElementById("deviceSepticView");
        this.deviceWateringView = document.getElementById("deviceWateringView");
        this.deviceRulesView = document.getElementById("deviceRulesView");
        this.deviceRingView = document.getElementById("deviceRingView");
        this.deviceAvrView = document.getElementById("deviceAvrView");
        this.deviceLeakView = document.getElementById("deviceLeakView");
        this.deviceNetworkView = document.getElementById("deviceNetworkView");

        this.mainMenu = document.getElementById("mainMenu");
        this.menuObjectsBtn = document.getElementById("menuObjects");
        this.menuDevicesBtn = document.getElementById("menuDevices");
        this.menuSettingsBtn = document.getElementById("menuSettings");
        this.settingsObjectsTile = document.getElementById(
            "settingsObjectsTile",
        );
        this.settingsDevicesTile = document.getElementById(
            "settingsDevicesTile",
        );
        this.settingsUsersTile = document.getElementById("settingsUsersTile");
        this.settingsTelegramTile = document.getElementById(
            "settingsTelegramTile",
        );
        this.topMenu = document.getElementById("topMenu");
        this.menuControllersBtn = document.getElementById("menuControllers");
        this.menuNetworkBtn = document.getElementById("menuNetwork");
        this.statusEl = document.getElementById("status");
        this.logoutBtn = document.getElementById("logoutBtn");
        this.loginForm = document.getElementById("loginForm");
        this.objectsList = document.getElementById("objectsList");
        this.adminDevices = document.getElementById("adminDevices");
        this.adminObjects = document.getElementById("adminObjects");
        this.adminUsers = document.getElementById("adminUsers");
        this.objectForm = document.getElementById("objectForm");
        this.userForm = document.getElementById("userForm");
        this.userAllowedObjects = document.getElementById(
            "userAllowedObjects",
        );
        this.deviceForm = document.getElementById("deviceForm");
        this.deviceObjectSelect = document.getElementById("deviceObjectSelect");
        this.telegramSettingsForm = document.getElementById(
            "telegramSettingsForm",
        );
        this.telegramSettingsInfo = document.getElementById(
            "telegramSettingsInfo",
        );

        this.devicesList = document.getElementById("devicesList");
        this.devicesEmpty = document.getElementById("devicesEmpty");
        this.devicesObject = document.getElementById("devicesObject");

        this.deviceTitle = document.getElementById("deviceTitle");
        this.deviceControllersTitle = document.getElementById(
            "deviceControllersTitle",
        );
        this.deviceSocketsTitle = document.getElementById("deviceSocketsTitle");
        this.deviceLightsTitle = document.getElementById("deviceLightsTitle");
        this.deviceTanksTitle = document.getElementById("deviceTanksTitle");
        this.deviceSecurityTitle = document.getElementById(
            "deviceSecurityTitle",
        );
        this.deviceMeteoTitle = document.getElementById("deviceMeteoTitle");
        this.deviceNetworkTitle = document.getElementById("deviceNetworkTitle");
        this.deviceStatusBody = document.getElementById("deviceStatusBody");
        this.deviceControllersGrid = document.getElementById(
            "deviceControllersGrid",
        );
        this.deviceCamerasGrid = document.getElementById("deviceCamerasGrid");
        this.deviceSocketsGrid = document.getElementById("deviceSocketsGrid");
        this.deviceLightsGrid = document.getElementById("deviceLightsGrid");
        this.deviceTanksGrid = document.getElementById("deviceTanksGrid");
        this.deviceSecurityGrid = document.getElementById("deviceSecurityGrid");
        this.deviceSecuritySummary = document.getElementById(
            "deviceSecuritySummary",
        );
        this.deviceSecurityActions = document.getElementById(
            "deviceSecurityActions",
        );
        this.deviceMeteoGrid = document.getElementById("deviceMeteoGrid");
        this.deviceThermoGrid = document.getElementById("deviceThermoGrid");
        this.deviceSepticGrid = document.getElementById("deviceSepticGrid");
        this.deviceWateringGrid = document.getElementById("deviceWateringGrid");
        this.deviceRulesGrid = document.getElementById("deviceRulesGrid");
        this.deviceRingWrap = document.getElementById("deviceRingWrap");
        this.deviceAvrWrap = document.getElementById("deviceAvrWrap");
        this.deviceLeakActions = document.getElementById("deviceLeakActions");
        this.deviceLeakGrid = document.getElementById("deviceLeakGrid");
        this.deviceWifiBody = document.getElementById("deviceWifiBody");
        this.deviceGsmBody = document.getElementById("deviceGsmBody");
        this.deviceScope = document.getElementById("deviceScope");
        this.socketsScope = document.getElementById("socketsScope");
        this.lightsScope = document.getElementById("lightsScope");
        this.tanksScope = document.getElementById("tanksScope");
        this.securityScope = document.getElementById("securityScope");
        this.meteoScope = document.getElementById("meteoScope");
        this.refreshDeviceBtn = document.getElementById("refreshDevice");
        this.refreshSocketsBtn = document.getElementById("refreshSockets");
        this.refreshLightsBtn = document.getElementById("refreshLights");
        this.refreshTanksBtn = document.getElementById("refreshTanks");
        this.refreshSecurityBtn = document.getElementById("refreshSecurity");
        this.refreshMeteoBtn = document.getElementById("refreshMeteo");
        this.deviceNotice = document.getElementById("deviceNotice");
        this.deviceCamerasNotice =
            document.getElementById("deviceCamerasNotice");
        this.deviceSocketsNotice = document.getElementById(
            "deviceSocketsNotice",
        );
        this.deviceLightsNotice = document.getElementById("deviceLightsNotice");
        this.deviceTanksNotice = document.getElementById("deviceTanksNotice");
        this.deviceSecurityNotice = document.getElementById(
            "deviceSecurityNotice",
        );
        this.deviceMeteoNotice = document.getElementById("deviceMeteoNotice");
        this.deviceThermoNotice = document.getElementById("deviceThermoNotice");
        this.deviceSepticNotice = document.getElementById("deviceSepticNotice");
        this.deviceWateringNotice = document.getElementById(
            "deviceWateringNotice",
        );
        this.deviceRulesNotice = document.getElementById("deviceRulesNotice");
        this.deviceRingNotice = document.getElementById("deviceRingNotice");
        this.deviceAvrNotice = document.getElementById("deviceAvrNotice");
        this.deviceLeakNotice = document.getElementById("deviceLeakNotice");

        this.backToObjects = document.getElementById("backToObjects");
        this.settingsBackFromObjects = document.getElementById(
            "settingsBackFromObjects",
        );
        this.settingsBackFromDevices = document.getElementById(
            "settingsBackFromDevices",
        );
        this.settingsBackFromUsers = document.getElementById(
            "settingsBackFromUsers",
        );
        this.settingsBackFromTelegram = document.getElementById(
            "settingsBackFromTelegram",
        );
        this.backToDevices = document.getElementById("backToDevices");
        this.backToDevicesFromControllers = document.getElementById(
            "backToDevicesFromControllers",
        );
        this.backToControllersFromCameras = document.getElementById(
            "backToControllersFromCameras",
        );
        this.backToControllersFromSockets = document.getElementById(
            "backToControllersFromSockets",
        );
        this.backToControllersFromLights = document.getElementById(
            "backToControllersFromLights",
        );
        this.backToControllersFromTanks = document.getElementById(
            "backToControllersFromTanks",
        );
        this.backToControllersFromSecurity = document.getElementById(
            "backToControllersFromSecurity",
        );
        this.backToControllersFromMeteo = document.getElementById(
            "backToControllersFromMeteo",
        );
        this.backToControllersFromThermo = document.getElementById(
            "backToControllersFromThermo",
        );
        this.backToControllersFromSeptic = document.getElementById(
            "backToControllersFromSeptic",
        );
        this.backToControllersFromWatering = document.getElementById(
            "backToControllersFromWatering",
        );
        this.backToControllersFromRules = document.getElementById(
            "backToControllersFromRules",
        );
        this.backToControllersFromRing = document.getElementById(
            "backToControllersFromRing",
        );
        this.backToControllersFromAvr = document.getElementById(
            "backToControllersFromAvr",
        );
        this.backToControllersFromLeak = document.getElementById(
            "backToControllersFromLeak",
        );
        this.backToDevicesFromNetwork = document.getElementById(
            "backToDevicesFromNetwork",
        );

        this._menuIndicatorRaf = null;
        if (typeof window !== "undefined") {
            window.addEventListener("resize", () =>
                this.refreshMenuIndicators(),
            );
        }
    }

    setStatus(text, ok = true) {
        this.statusEl.textContent = text;
        this.statusEl.className = ok ? "status ok" : "status error";
    }

    setDeviceNotice(text = "") {
        this.deviceNotice.textContent = text;
    }

    setCamerasNotice(text = "") {
        if (this.deviceCamerasNotice)
            this.deviceCamerasNotice.textContent = text;
    }

    setSocketsNotice(text = "") {
        this.deviceSocketsNotice.textContent = text;
    }

    setMeteoNotice(text = "") {
        this.deviceMeteoNotice.textContent = text;
    }

    setThermoNotice(text = "") {
        if (this.deviceThermoNotice) this.deviceThermoNotice.textContent = text;
    }

    setSepticNotice(text = "") {
        if (this.deviceSepticNotice) this.deviceSepticNotice.textContent = text;
    }

    setWateringNotice(text = "") {
        if (this.deviceWateringNotice)
            this.deviceWateringNotice.textContent = text;
    }

    setRulesNotice(text = "") {
        if (this.deviceRulesNotice) this.deviceRulesNotice.textContent = text;
    }

    setRingNotice(text = "") {
        if (this.deviceRingNotice) this.deviceRingNotice.textContent = text;
    }

    setAvrNotice(text = "") {
        if (this.deviceAvrNotice) this.deviceAvrNotice.textContent = text;
    }

    setLeakNotice(text = "") {
        if (this.deviceLeakNotice) this.deviceLeakNotice.textContent = text;
    }

    setLightsNotice(text = "") {
        this.deviceLightsNotice.textContent = text;
    }

    setTanksNotice(text = "") {
        this.deviceTanksNotice.textContent = text;
    }

    setSecurityNotice(text = "") {
        this.deviceSecurityNotice.textContent = text;
    }

    bindTargetPicker(onChange) {
        this._onTargetPickerChange =
            typeof onChange === "function" ? onChange : null;
        const selects = [
            this.deviceScope,
            this.socketsScope,
            this.lightsScope,
            this.tanksScope,
            this.securityScope,
            this.meteoScope,
        ].filter(Boolean);
        for (const select of selects) {
            if (select.dataset.boundTargetPicker === "1") continue;
            select.dataset.boundTargetPicker = "1";
            select.addEventListener("change", () => {
                if (!this._onTargetPickerChange) return;
                const raw = String(select.value || "local");
                if (raw.startsWith("stack:")) {
                    const nodeId = Number(raw.slice(6));
                    if (Number.isFinite(nodeId) && nodeId > 0) {
                        this._onTargetPickerChange("stack", nodeId);
                        return;
                    }
                }
                this._onTargetPickerChange("local", null);
            });
        }
    }

    renderTargetPicker(
        options = [],
        currentUnit = "local",
        currentNodeId = null,
    ) {
        const selects = [
            this.deviceScope,
            this.socketsScope,
            this.lightsScope,
            this.tanksScope,
            this.securityScope,
            this.meteoScope,
        ].filter(Boolean);
        if (!selects.length) return;
        const rows = Array.isArray(options) ? options : [];
        const normalized = rows.map((item) => {
            const unit = item?.unit === "stack" ? "stack" : "local";
            const nodeId = unit === "stack" ? Number(item?.node_id) : null;
            const value =
                unit === "stack" && Number.isFinite(nodeId) && nodeId > 0
                    ? `stack:${nodeId}`
                    : "local";
            return {
                value,
                label: String(
                    item?.label ||
                        (value === "local"
                            ? "Локальное устройство"
                            : `Stack #${nodeId}`),
                ),
            };
        });
        const values = new Set(normalized.map((r) => r.value));
        const selectedValue =
            currentUnit === "stack" && Number(currentNodeId) > 0
                ? `stack:${Number(currentNodeId)}`
                : "local";
        const safeValue = values.has(selectedValue) ? selectedValue : "local";
        for (const select of selects) {
            select.innerHTML = "";
            for (const row of normalized) {
                const opt = document.createElement("option");
                opt.value = row.value;
                opt.textContent = row.label;
                select.appendChild(opt);
            }
            if (!normalized.length) {
                const opt = document.createElement("option");
                opt.value = "local";
                opt.textContent = "Локальное устройство";
                select.appendChild(opt);
            }
            select.value = safeValue;
        }
    }

    renderEmptyState(title = "Нет данных", actionLabel = "Обновить") {
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
            this.deviceCamerasGrid,
            this.deviceSocketsGrid,
            this.deviceLightsGrid,
            this.deviceTanksGrid,
            this.deviceSecurityGrid,
            this.deviceMeteoGrid,
            this.deviceThermoGrid,
            this.deviceSepticGrid,
            this.deviceWateringGrid,
            this.deviceRulesGrid,
            this.deviceRingWrap,
            this.deviceAvrWrap,
            this.deviceLeakGrid,
            this.deviceWifiBody,
            this.deviceGsmBody,
        ];
        for (const el of targets) {
            if (!el) continue;
            el.classList.toggle("is-loading", Boolean(flag));
        }
    }

    applyObjectTheme(objectName = "") {
        const body = document.body;
        if (!body) return;
        const name = String(objectName || "").trim();
        if (!name) {
            body.removeAttribute("data-object-theme");
            return;
        }
        const raw = asArray(this.state.objects).find(
            (item) => normalizeObjectItem(item).name === name,
        );
        const icon = normalizeObjectItem(raw || { name, icon: "house" }).icon;
        body.setAttribute("data-object-theme", icon);
    }

    animateViewTransition(view) {
        const viewMap = {
            login: this.loginView,
            objects: this.objectsView,
            settings: this.settingsView,
            settingsObjects: this.settingsView,
            settingsDevices: this.settingsView,
            settingsUsers: this.settingsView,
            settingsTelegram: this.settingsView,
            devices: this.devicesView,
            device: this.deviceView,
            deviceControllers: this.deviceControllersView,
            deviceCameras: this.deviceCamerasView,
            deviceSockets: this.deviceSocketsView,
            deviceLights: this.deviceLightsView,
            deviceTanks: this.deviceTanksView,
            deviceSecurity: this.deviceSecurityView,
            deviceMeteo: this.deviceMeteoView,
            deviceThermo: this.deviceThermoView,
            deviceSeptic: this.deviceSepticView,
            deviceWatering: this.deviceWateringView,
            deviceRules: this.deviceRulesView,
            deviceRing: this.deviceRingView,
            deviceAvr: this.deviceAvrView,
            deviceLeak: this.deviceLeakView,
            deviceNetwork: this.deviceNetworkView,
        };
        const el = viewMap[view];
        if (!el) return;
        el.classList.remove("view-enter");
        void el.offsetWidth;
        el.classList.add("view-enter");
    }

    updateMenuIndicator(menuEl) {
        if (!menuEl) return;
        const activeBtn = menuEl.querySelector(".menu-btn.active");
        if (!activeBtn || menuEl.classList.contains("hidden")) {
            menuEl.style.setProperty("--menu-ind-o", "0");
            return;
        }
        const menuRect = menuEl.getBoundingClientRect();
        const btnRect = activeBtn.getBoundingClientRect();
        const x = Math.max(0, btnRect.left - menuRect.left);
        const w = Math.max(0, btnRect.width);
        menuEl.style.setProperty("--menu-ind-x", `${x}px`);
        menuEl.style.setProperty("--menu-ind-w", `${w}px`);
        menuEl.style.setProperty("--menu-ind-o", "1");
    }

    refreshMenuIndicators() {
        if (this._menuIndicatorRaf && typeof window !== "undefined") {
            window.cancelAnimationFrame(this._menuIndicatorRaf);
        }
        if (typeof window === "undefined") return;
        this._menuIndicatorRaf = window.requestAnimationFrame(() => {
            this.updateMenuIndicator(this.mainMenu);
            this.updateMenuIndicator(this.topMenu);
            this._menuIndicatorRaf = null;
        });
    }

    show(view) {
        const settingsViews = new Set([
            "settings",
            "settingsObjects",
            "settingsDevices",
            "settingsUsers",
            "settingsTelegram",
        ]);
        const activeSettingsView = settingsViews.has(view) ? view : null;
        this.loginView.classList.toggle("hidden", view !== "login");
        this.objectsView.classList.toggle("hidden", view !== "objects");
        this.settingsView.classList.toggle("hidden", !activeSettingsView);
        this.devicesView.classList.toggle("hidden", view !== "devices");
        this.deviceView.classList.toggle("hidden", view !== "device");
        this.deviceControllersView.classList.toggle(
            "hidden",
            view !== "deviceControllers",
        );
        this.deviceCamerasView.classList.toggle(
            "hidden",
            view !== "deviceCameras",
        );
        this.deviceSocketsView.classList.toggle(
            "hidden",
            view !== "deviceSockets",
        );
        this.deviceLightsView.classList.toggle(
            "hidden",
            view !== "deviceLights",
        );
        this.deviceTanksView.classList.toggle("hidden", view !== "deviceTanks");
        this.deviceSecurityView.classList.toggle(
            "hidden",
            view !== "deviceSecurity",
        );
        this.deviceMeteoView.classList.toggle("hidden", view !== "deviceMeteo");
        this.deviceThermoView.classList.toggle(
            "hidden",
            view !== "deviceThermo",
        );
        this.deviceSepticView.classList.toggle(
            "hidden",
            view !== "deviceSeptic",
        );
        this.deviceWateringView.classList.toggle(
            "hidden",
            view !== "deviceWatering",
        );
        this.deviceRulesView.classList.toggle("hidden", view !== "deviceRules");
        this.deviceRingView.classList.toggle("hidden", view !== "deviceRing");
        this.deviceAvrView.classList.toggle("hidden", view !== "deviceAvr");
        this.deviceLeakView.classList.toggle("hidden", view !== "deviceLeak");
        this.deviceNetworkView.classList.toggle(
            "hidden",
            view !== "deviceNetwork",
        );

        const inAuthViews = view !== "login";
        this.mainMenu.classList.toggle("hidden", !inAuthViews);
        this.menuObjectsBtn.classList.toggle(
            "active",
            view !== "login" && !activeSettingsView,
        );
        this.menuSettingsBtn.classList.toggle(
            "active",
            Boolean(activeSettingsView),
        );

        const inDevicePages =
            view === "device" ||
            view === "deviceControllers" ||
            view === "deviceCameras" ||
            view === "deviceSockets" ||
            view === "deviceLights" ||
            view === "deviceTanks" ||
            view === "deviceSecurity" ||
            view === "deviceMeteo" ||
            view === "deviceThermo" ||
            view === "deviceSeptic" ||
            view === "deviceWatering" ||
            view === "deviceRules" ||
            view === "deviceRing" ||
            view === "deviceAvr" ||
            view === "deviceLeak" ||
            view === "deviceNetwork";
        this.topMenu.classList.toggle("hidden", !inDevicePages);
        this.menuControllersBtn.classList.toggle(
            "active",
            view === "deviceControllers" ||
                view === "deviceCameras" ||
                view === "deviceSockets" ||
                view === "deviceLights" ||
                view === "deviceTanks" ||
                view === "deviceSecurity" ||
                view === "deviceMeteo" ||
                view === "deviceThermo" ||
                view === "deviceSeptic" ||
                view === "deviceWatering" ||
                view === "deviceRules" ||
                view === "deviceRing" ||
                view === "deviceAvr" ||
                view === "deviceLeak",
        );
        this.menuNetworkBtn.classList.toggle(
            "active",
            view === "deviceNetwork",
        );
        if (activeSettingsView === "settingsObjects")
            this.showSettingsPanel("objects");
        else if (activeSettingsView === "settingsDevices")
            this.showSettingsPanel("devices");
        else if (activeSettingsView === "settingsUsers")
            this.showSettingsPanel("users");
        else if (activeSettingsView === "settingsTelegram")
            this.showSettingsPanel("telegram");
        else if (activeSettingsView === "settings")
            this.showSettingsPanel("home");
        this.refreshMenuIndicators();
        this.animateViewTransition(view);
    }

    showSettingsPanel(panel = "home") {
        const target = String(panel || "home");
        const panelMap = {
            home: this.settingsHomePanel,
            objects: this.settingsObjectsPanel,
            devices: this.settingsDevicesPanel,
            users: this.settingsUsersPanel,
            telegram: this.settingsTelegramPanel,
        };
        for (const [key, el] of Object.entries(panelMap)) {
            if (!el) continue;
            el.classList.toggle("hidden", key !== target);
        }
    }

    renderObjects(onSelect) {
        this.objectsList.innerHTML = "";
        this.deviceObjectSelect.innerHTML = "";
        for (const raw of this.state.objects) {
            const obj = normalizeObjectItem(raw);
            const btn = document.createElement("button");
            btn.className = "object-tile";
            btn.innerHTML = `
        ${objectIconSvg(obj.icon)}
        <span class="object-name">${esc(obj.name)}</span>
      `;
            btn.addEventListener("click", () => onSelect(obj.name));
            this.objectsList.appendChild(btn);

            const opt = document.createElement("option");
            opt.value = obj.name;
            opt.textContent = obj.name;
            this.deviceObjectSelect.appendChild(opt);
        }
    }

    renderDevices(onSelect) {
        this.devicesList.innerHTML = "";
        if (!this.state.devices.length) {
            this.devicesEmpty.classList.remove("hidden");
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
        this.devicesEmpty.classList.add("hidden");
        for (const device of this.state.devices) {
            const btn = document.createElement("button");
            btn.className = "device-tile";
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
        <span class="device-name">${esc(device.name || "Без имени")}</span>
        <span class="device-id">#${esc(device.device_id)}</span>
      `;
            btn.addEventListener("click", () => onSelect(device));
            this.devicesList.appendChild(btn);
        }
    }

    renderScopeOptions(stack, currentUnit = "local", currentNodeId = null) {
        if (
            !this.deviceScope &&
            !this.socketsScope &&
            !this.lightsScope &&
            !this.tanksScope &&
            !this.securityScope &&
            !this.meteoScope
        )
            return;
        const nodes = asArray(stack?.nodes);
        const options = [{ value: "local", label: "Локальное устройство" }];
        for (const node of nodes) {
            if (!node?.node_id) continue;
            options.push({
                value: `stack:${Number(node.node_id)}`,
                label: `Stack #${Number(node.node_id)}${node.name ? ` - ${node.name}` : ""}`,
            });
        }

        const selectedValue =
            currentUnit === "stack" && currentNodeId
                ? `stack:${Number(currentNodeId)}`
                : "local";
        const fillSelect = (select) => {
            if (!select) return;
            select.innerHTML = "";
            for (const option of options) {
                const el = document.createElement("option");
                el.value = option.value;
                el.textContent = option.label;
                select.appendChild(el);
            }
            if (options.some((o) => o.value === selectedValue)) {
                select.value = selectedValue;
            } else {
                select.value = "local";
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

        this.deviceStatusBody.innerHTML = `
      <tr><td>Имя устройства</td><td><strong>${esc(detail.name || "-")}</strong></td></tr>
      <tr><td>Дата</td><td><strong>${esc(rtc.date || "-")}</strong></td></tr>
      <tr><td>Время</td><td><strong>${esc(rtc.time || "-")}</strong></td></tr>
      <tr><td>RTC температура</td><td><strong>${rtcTemp}</strong></td></tr>
      <tr><td>Температура платы</td><td><strong>${boardTemp}</strong></td></tr>
      <tr><td>Вентилятор</td><td>${onOffDot(Boolean(fan.fan_on))}</td></tr>
    `;

        const cards = summarizeControllers(
            detail.controllers,
            detail.summary || detail.system?.summary || null,
            {
                preferKeyPresence:
                    detail?.scope_unit === "stack" &&
                    Number(detail?.scope_node_id || 0) > 0,
            },
        );
        if (!cards.length) {
            this.deviceControllersGrid.innerHTML = this.renderEmptyState(
                "Нет доступных контроллеров",
            );
            return;
        }
        this.deviceControllersGrid.innerHTML = cards
            .map(
                (card) => `
        <div class="ctrl-card" data-controller="${esc(card.key)}">
          <div class="ctrl-icon-wrap" aria-hidden="true">
            ${controllerIconSvg(card.key)}
          </div>
          <div class="ctrl-main">
            <div class="ctrl-head">
              <span class="ctrl-title">${esc(card.title)}</span>
              ${onOffDot(card.online)}
            </div>
            <div class="ctrl-sub">${card.online ? "онлайн" : "оффлайн"}</div>
            <div class="ctrl-value">${esc(card.status)}</div>
          </div>
        </div>
      `,
            )
            .join("");
    }

    renderSockets(detail) {
        const sockets = asArray(detail?.controllers?.sockets);
        if (!sockets.length) {
            this.deviceSocketsGrid.innerHTML = this.renderEmptyState(
                "Нет данных по розеткам",
            );
            return;
        }

        this.deviceSocketsGrid.innerHTML = sockets
            .map((socket) => {
                const on = Boolean(socket.state);
                const enabled = Boolean(socket.enabled);
                const writable = controllerAccess(
                    detail,
                    "sockets",
                    socket.id,
                    "toggle",
                ).write;
                return `
        <article class="socket-tile ${enabled && writable ? "" : "disabled"}" data-socket-id="${Number(socket.id)}">
          <div class="socket-visual ${on ? "on" : "off"}">
            <span class="socket-chip">#${Number(socket.id)}</span>
            <svg class="sock-icon ${on ? "on" : "off"}" viewBox="0 0 64 64" aria-hidden="true">
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
            <div class="socket-meta">${!enabled ? statusBadge("Отключена", "disabled") : statusBadge(on ? "Включена" : "Выключена", on ? "on" : "off")}</div>
            <div class="socket-pending-text">Ожидание...</div>
          </div>
        </article>
      `;
            })
            .join("");
    }

    renderCameras(detail) {
        if (!this.deviceCamerasGrid) return;
        const cameras = asArray(detail?.controllers?.cameras).filter((camera) =>
            Boolean(camera?.enabled),
        );
        if (!cameras.length) {
            this.deviceCamerasGrid.innerHTML = this.renderEmptyState(
                "Нет включенных камер",
                "Обновить",
            );
            return;
        }

        this.deviceCamerasGrid.innerHTML = cameras
            .map((camera) => {
                const id = Number(camera?.id);
                const enabled = Boolean(camera?.enabled);
                const busy = Boolean(camera?.busy);
                const latestUrl = String(camera?.latest_url || "").trim();
                const lastError = String(camera?.last_error || "").trim();
                const updatedMs = Number(camera?.updated_ms || 0);
                const writable = controllerAccess(
                    detail,
                    "cameras",
                    id,
                    "snapshot",
                ).write;
                const statusText = !enabled
                    ? "Отключена"
                    : busy
                      ? "Получаем фото..."
                      : lastError
                        ? lastError
                        : latestUrl
                          ? "Фото загружено в облако"
                          : "Снимок еще не получен";
                const statusTone = !enabled
                    ? "disabled"
                    : busy
                      ? "warn"
                      : lastError
                        ? "alert"
                        : latestUrl
                          ? "ready"
                          : "neutral";
                const previewUrl = latestUrl
                    ? `${latestUrl}${latestUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(String(updatedMs || Date.now()))}`
                    : "";
                return `
        <article class="camera-tile ${enabled ? "" : "disabled"}" data-camera-id="${id}">
          <div class="camera-preview">
            <div class="camera-preview-badge">
              <span class="camera-status-dot ${busy ? "busy" : enabled ? "ok" : ""}"></span>
              <span>#${id}</span>
            </div>
            ${previewUrl ? `<img src="${esc(previewUrl)}" alt="${esc(camera?.name || `Камера ${id}`)}" loading="lazy">` : ""}
            ${previewUrl ? "" : `<div class="camera-preview-empty">Нет снимка</div>`}
          </div>
          <div class="camera-side">
            <div class="camera-title">${esc(camera?.name || `Камера #${id}`)}</div>
            <div class="camera-meta">
              ${statusBadge(statusText, statusTone)}
            </div>
            <div class="camera-url">${latestUrl ? `Cloud URL: ${esc(latestUrl)}` : "Cloud URL появится после первого снимка"}</div>
            <div class="camera-actions">
              <button class="ghost btn-sm camera-btn" data-action="snapshot" ${enabled && writable && !busy ? "" : "disabled"}>Получить фото</button>
            </div>
            <div class="camera-inline-status">${esc(statusText)}</div>
          </div>
        </article>
      `;
            })
            .join("");
    }

    renderMeteo(detail) {
        const meteo = asArray(detail?.controllers?.meteo);
        if (!meteo.length) {
            this.deviceMeteoGrid.innerHTML = this.renderEmptyState(
                stackControllerPending(detail, "meteo")
                    ? "Идёт загрузка метео со слейва"
                    : "Нет данных по метео",
            );
            return;
        }

        this.deviceMeteoGrid.innerHTML = meteo
            .map((sensor) => {
                const ok = Boolean(sensor.ok);
                const enabled = Boolean(sensor.enabled);
                const hasTemp = Boolean(sensor.has_temp);
                const hasHum = Boolean(sensor.has_hum);
                const type = String(sensor.type || "").toLowerCase();
                const showHum = type === "dht22" && hasHum;
                const temp = hasTemp ? Number(sensor.temp_c).toFixed(1) : "--";
                const hum = showHum ? Number(sensor.hum).toFixed(1) : "--";
                const hasData = hasTemp || showHum;
                const statusClass = hasData
                    ? ok
                        ? "status-ok"
                        : "status-err"
                    : "status-na";
                const statusText = !enabled
                    ? "Отключен"
                    : !hasData
                      ? "Нет данных"
                      : ok
                        ? "Норма"
                        : "Ошибка";
                const pinNum = Number(sensor.pin);
                const dhtSource = Number.isFinite(pinNum)
                    ? `sens-${pinNum}`
                    : null;
                const sourceLabel =
                    type === "dht22"
                        ? dhtSource || sensor.addr || sensor.pin || "-"
                        : sensor.addr || sensor.pin || "-";
                return `
        <article class="meteo-tile ${enabled ? "" : "disabled"}">
          <div class="meteo-visual">
            <span class="socket-chip">#${Number(sensor.id)}</span>
            <svg class="sensor-icon ${showHum ? "sensor-icon-dht22" : ""} ${ok && hasData ? "" : "na"}" viewBox="0 0 64 64" aria-hidden="true">
              <path fill="currentColor" d="M32 6c-5.5 0-10 4.5-10 10v19.2c-2.6 2.4-4 5.7-4 9.3 0 7.2 5.8 13 13 13s13-5.8 13-13c0-3.6-1.4-6.9-4-9.3V16c0-5.5-4.5-10-10-10zm6 33.1V16c0-3.3-2.7-6-6-6s-6 2.7-6 6v23.1l-0.9 0.9c-1.8 1.7-2.8 3.9-2.8 6.4 0 4.9 4 9 9 9s9-4 9-9c0-2.5-1-4.8-2.8-6.4l-0.5-0.5z"/>
              <rect x="30" y="20" width="4" height="20" rx="2" fill="currentColor"/>
            </svg>
            <div class="meteo-readout">
              <div class="meteo-temp">${esc(temp)}</div>
              <div class="meteo-unit">&deg;C</div>
              ${
                  showHum
                      ? `
                <div class="meteo-hum-wrap">
                  <svg class="sensor-hum-icon" viewBox="0 0 64 64" aria-hidden="true">
                    <path fill="currentColor" d="M32 6c7 12 16 22 16 34 0 8.8-7.2 16-16 16S16 48.8 16 40c0-12 9-22 16-34z"/>
                  </svg>
                  <div class="meteo-hum">${esc(hum)}</div>
                  <div class="meteo-unit">%</div>
                </div>
              `
                      : ""
              }
            </div>
          </div>
          <div class="socket-main">
            <div class="socket-head">
              <div class="socket-name">${esc(sensor.name || `Метео ${Number(sensor.id)}`)}</div>
              <span class="status-dot ${statusClass}"></span>
            </div>
            <div class="socket-meta">${!enabled ? statusBadge(statusText, "disabled") : statusBadge(statusText, ok && hasData ? "on" : hasData ? "alert" : "neutral")}</div>
            <div class="socket-meta">Тип: <span class="meta-value">${esc(sensor.type || "-")}</span></div>
            <div class="socket-meta">Источник: <span class="meta-value">${esc(sourceLabel)}</span></div>
          </div>
        </article>
      `;
            })
            .join("");
    }

    renderLights(detail) {
        const lights = asArray(detail?.controllers?.lights);
        if (!lights.length) {
            this.deviceLightsGrid.innerHTML = this.renderEmptyState(
                "Нет данных по свету",
            );
            return;
        }

        this.deviceLightsGrid.innerHTML = lights
            .map((light) => {
                const on = Boolean(light.state);
                const enabled = Boolean(light.enabled);
                const writable = controllerAccess(
                    detail,
                    "lights",
                    light.id,
                    "toggle",
                ).write;
                return `
        <article class="light-tile ${enabled && writable ? "" : "disabled"}" data-light-id="${Number(light.id)}">
          <div class="light-visual ${on ? "on" : "off"}">
            <span class="socket-chip">#${Number(light.id)}</span>
            <svg class="light-icon ${on ? "on" : "off"}" viewBox="0 0 64 64" aria-hidden="true">
              <path fill="currentColor" d="M32 4c-9.9 0-18 8.1-18 18 0 7.1 4.1 13.2 10 16.2V50c0 2.2 1.8 4 4 4h8c2.2 0 4-1.8 4-4V38.2c5.9-3 10-9.1 10-16.2 0-9.9-8.1-18-18-18zm6 42H26v-4h12v4zm0-8H26v-4h12v4z"/>
            </svg>
          </div>
          <div class="socket-main">
            <div class="socket-head">
              <div class="socket-name">${esc(light.name || `Свет ${Number(light.id)}`)}</div>
              ${onOffDot(on)}
            </div>
            <div class="socket-meta">${enabled ? statusBadge("Доступен", "ready") : statusBadge("Отключен", "disabled")}</div>
            <div class="light-status-line">
              <span class="status-dot ${on ? "status-on" : "status-off"}"></span>
              <span class="status-text">${on ? "Включена" : "Выключена"}</span>
            </div>
            <div class="socket-pending-text">Ожидание...</div>
          </div>
        </article>
      `;
            })
            .join("");
    }

    renderTanks(detail) {
        const tanks = asArray(detail?.controllers?.tanks);
        if (!tanks.length) {
            this.deviceTanksGrid.innerHTML = this.renderEmptyState(
                stackControllerPending(detail, "tanks")
                    ? "Идёт загрузка баков со слейва"
                    : "Нет данных по бакам",
            );
            return;
        }

        this.deviceTanksGrid.innerHTML = tanks
            .map((tank) => {
                const enabled = Boolean(tank.enabled);
                const writable = controllerAccess(
                    detail,
                    "tanks",
                    tank.id,
                    "power",
                ).write;
                const powerOn = Boolean(tank.power_on);
                const valveOn = Boolean(tank.valve_on);
                const pumpOn = Boolean(tank.pump_on);
                const alarmOn = Boolean(tank.alarm_on);
                let levelPct = 0;
                let levelClass = "level-empty";
                let levelText = "0%";
                if (tank.level_full) {
                    levelPct = 99;
                    levelClass = "level-full";
                    levelText = "99%";
                } else if (tank.level_mid) {
                    levelPct = 66;
                    levelClass = "level-mid";
                    levelText = "66%";
                } else if (tank.level_low) {
                    levelPct = 33;
                    levelClass = "level-low";
                    levelText = "33%";
                }

                return `
        <article class="tank-tile ${enabled && writable ? "" : "disabled"}" data-tank-id="${Number(tank.id)}" data-power-on="${powerOn ? "1" : "0"}">
          <div>
            <div class="tank-visual-control">
              <div class="tank-fill ${levelClass}" style="height:${levelPct}%"></div>
              <div class="tank-label">${levelText}</div>
            </div>
            <div class="status-line">
              <span class="badge">ID ${Number(tank.id)}</span>
              <span class="badge">${powerOn ? "питание ВКЛ" : "питание ВЫКЛ"}</span>
            </div>
          </div>
          <div class="socket-main">
            <div class="socket-head">
              <div class="socket-name">${esc(tank.name || `Бак ${Number(tank.id)}`)}</div>
              ${onOffDot(enabled)}
            </div>
            <div class="socket-meta">${enabled ? statusBadge("Доступен", "ready") : statusBadge("Отключен", "disabled")}</div>
            <div class="tank-status-stack">
              <div class="tank-status-item ${valveOn ? "is-on" : "is-off"}">
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
                <span class="tank-status-value">${valveOn ? "ВКЛ" : "ВЫКЛ"}</span>
              </div>
              <div class="tank-status-item ${pumpOn ? "is-on" : "is-off"}">
                <span class="tank-status-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <circle cx="11" cy="12" r="4.5"></circle>
                    <path d="M15.5 10h2.5a2 2 0 0 1 0 4h-2.5"></path>
                    <path d="M8.5 8.5l3 3.5-4.2 1.1"></path>
                  </svg>
                </span>
                <span class="tank-status-label">Насос</span>
                <span class="tank-status-value">${pumpOn ? "ВКЛ" : "ВЫКЛ"}</span>
              </div>
              <div class="tank-status-item ${alarmOn ? "is-alarm" : "is-ok"}">
                <span class="tank-status-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M12 4 20 19H4Z"></path>
                    <path d="M12 9v4"></path>
                    <circle cx="12" cy="16.5" r="0.8" class="tank-status-fill"></circle>
                  </svg>
                </span>
                <span class="tank-status-label">Авария</span>
                <span class="tank-status-value">${alarmOn ? "ДА" : "НЕТ"}</span>
              </div>
            </div>
            <div class="socket-actions">
              <button class="ghost btn-sm ${powerOn ? "btn-off" : "btn-on"}" data-action="power-toggle" ${enabled && writable ? "" : "disabled"}>${powerOn ? "Питание ВЫКЛ" : "Питание ВКЛ"}</button>
            </div>
          </div>
        </article>
      `;
            })
            .join("");
    }

    renderSecurity(detail) {
        const security = detail?.controllers?.security || null;
        const sensors = asArray(security?.sensors);
        const armed = Boolean(security?.armed);
        const alarm = Boolean(security?.alarm);
        const enabled = Boolean(security?.enabled);
        const gsmOk = Boolean(
            detail?.system?.gsm?.started || detail?.system?.gsm?.enabled,
        );

        this.deviceSecuritySummary.innerHTML = `
      ${summaryIndicator("Режим", armed ? "На охране" : "Снято", alarm ? "alert" : armed ? "ready" : "off")}
      ${summaryIndicator("Тревога", alarm ? "Активна" : "Нет", alarm ? "alert" : "ready")}
      ${summaryIndicator("GSM", gsmOk ? "На связи" : "Нет связи", gsmOk ? "ready" : "warn")}
      ${summaryIndicator("Контур", enabled ? "Включен" : "Отключен", enabled ? "on" : "off")}
    `;

        this.deviceSecurityActions
            .querySelectorAll("button[data-action]")
            .forEach((btn) => {
                const writable = controllerAccess(
                    detail,
                    "security",
                    null,
                    btn.dataset.action || "",
                ).write;
                btn.disabled = !enabled || !writable;
            });

        if (!sensors.length) {
            this.deviceSecurityGrid.innerHTML = this.renderEmptyState(
                "Нет данных по датчикам",
            );
            return;
        }

        this.deviceSecurityGrid.innerHTML = sensors
            .map((sensor) => {
                const isEnabled = Boolean(sensor.enabled);
                const detect = Boolean(sensor.detect);
                const type = String(sensor.type || "").toLowerCase();
                const name = sensor.name || `Датчик ${Number(sensor.id)}`;
                const silent = Boolean(sensor.silent);
                const iconClass = !isEnabled ? "off" : detect ? "alert" : "on";
                return `
        <article class="security-tile ${isEnabled ? "" : "disabled"}">
          <div class="security-visual">
            <span class="socket-chip">#${Number(sensor.id)}</span>
            <svg class="security-icon ${iconClass}" viewBox="0 0 64 64" aria-hidden="true">
              ${
                  type === "reed"
                      ? '<rect x="6" y="18" width="14" height="28" rx="3" fill="currentColor"/><rect x="44" y="18" width="14" height="28" rx="3" fill="currentColor"/><rect x="22" y="30" width="20" height="4" rx="2" fill="currentColor"/>'
                      : '<circle cx="32" cy="24" r="6" fill="currentColor"/><path d="M14 48c6-10 12-14 18-14s12 4 18 14" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M8 20c6-6 12-10 18-12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M56 20c-6-6-12-10-18-12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'
              }
            </svg>
          </div>
          <div class="socket-main">
            <div class="socket-head">
              <div class="socket-name">${esc(name)}</div>
              <span class="status-dot ${!isEnabled ? "status-off" : detect ? "status-err" : "status-on"}"></span>
            </div>
            <div class="socket-meta">${!isEnabled ? statusBadge("Отключен", "disabled") : statusBadge(detect ? "Сработал" : "Активен", detect ? "alert" : "on")}</div>
            <div class="socket-meta">Тип: <span class="meta-value">${esc(type || "-")}</span></div>
            <div class="socket-meta">Тихий: <span class="meta-value">${silent ? "Да" : "Нет"}</span></div>
          </div>
        </article>
      `;
            })
            .join("");
    }

    renderNetwork(detail) {
        const system = detail?.system || {};
        const wifi = system.wifi || {};
        const gsm = system.gsm || {};

        this.deviceWifiBody.innerHTML = `
      <tr><td>Режим</td><td><strong>${esc(wifi.mode || "-")}</strong></td></tr>
      <tr><td>SSID</td><td><strong>${esc(wifi.ssid || "-")}</strong></td></tr>
      <tr><td>AP SSID</td><td><strong>${esc(wifi.ap_ssid || "-")}</strong></td></tr>
      <tr><td>IP</td><td><strong>${esc(wifi.ip || "-")}</strong></td></tr>
      <tr><td>MAC</td><td><strong>${esc(wifi.mac || "-")}</strong></td></tr>
    `;

        this.deviceGsmBody.innerHTML = `
      <tr><td>Включен</td><td><strong>${gsm.enabled ? "Да" : "Нет"}</strong></td></tr>
      <tr><td>Состояние</td><td><strong>${gsm.started ? "Запущен" : "Остановлен"}</strong></td></tr>
      <tr><td>IMEI</td><td><strong>${esc(gsm.imei || "-")}</strong></td></tr>
      <tr><td>IMSI</td><td><strong>${esc(gsm.imsi || "-")}</strong></td></tr>
      <tr><td>Оператор</td><td><strong>${esc(gsm.operator || "-")}</strong></td></tr>
      <tr><td>Сигнал</td><td><strong>${esc(gsm.signal || "-")}</strong></td></tr>
      <tr><td>Регистрация</td><td><strong>${esc(gsm.reg_status || "-")}</strong></td></tr>
      <tr><td>Ошибка</td><td><strong>${esc(gsm.last_error || "-")}</strong></td></tr>
      <tr><td>URC</td><td><strong>${esc(gsm.last_urc || "-")}</strong></td></tr>
      <tr><td>Звонок</td><td><strong>${esc(gsm.last_call || "-")}</strong></td></tr>
      <tr><td>USSD запрос</td><td><strong>${esc(gsm.last_ussd || "-")}</strong></td></tr>
      <tr><td>HTTP код</td><td><strong>${esc(gsm.last_http_status ?? "-")}</strong></td></tr>
      <tr><td>HTTP длина</td><td><strong>${esc(gsm.last_http_len ?? "-")}</strong></td></tr>
    `;
    }

    renderThermo(detail) {
        if (!this.deviceThermoGrid) return;
        const list = asArray(detail?.controllers?.thermo);
        if (!list.length) {
            this.deviceThermoGrid.innerHTML = this.renderEmptyState(
                stackControllerPending(detail, "thermo")
                    ? "Идёт загрузка термостатов со слейва"
                    : "Нет данных по термо",
            );
            return;
        }
        const modeLabel = (mode) => {
            const m = String(mode || "off");
            if (m === "heat_only") return "Нагрев";
            if (m === "cool_only") return "Охлаждение";
            if (m === "auto") return "Авто";
            return "Выкл";
        };
        const modeIcon = (mode) => {
            const m = String(mode || "off");
            if (m === "heat_only") return "🔥";
            if (m === "cool_only") return "❄️";
            if (m === "auto") return "◌";
            return "⏻";
        };
        this.deviceThermoGrid.innerHTML = list
            .map((item) => {
                const id = Number(item?.id);
                const enabled = Boolean(item?.enabled);
                const powerOn = Boolean(item?.power_on);
                const heatOn = Boolean(item?.heat_on);
                const coolOn = Boolean(item?.cool_on);
                const mode = String(item?.mode || "off");
                const target = Number(item?.target ?? item?.target_c);
                const sensor = Number(
                    item?.temp_c ?? item?.sensor_temp_c ?? item?.sensor_temp,
                );
                const sensorHasTemp = Boolean(
                    item?.has_temp ??
                        item?.sensor_has_temp ??
                        Number.isFinite(sensor),
                );
                const sensorName = String(
                    item?.sensor_name ?? item?.sensor_label ?? "",
                ).trim();
                const targetText = Number.isFinite(target)
                    ? String(Math.round(target))
                    : "--";
                const sensorText = sensorHasTemp && Number.isFinite(sensor)
                    ? sensor.toFixed(1)
                    : "--";
                const sensorLabel = sensorName
                    ? `Датчик: ${sensorName}`
                    : `Датчик #${Number(item?.sensor || 0) || "?"}`;
                const processText = heatOn
                    ? "нагрев"
                    : coolOn
                      ? "охлаждение"
                      : "ожидание";
                const processBadgeTone = !enabled
                    ? "disabled"
                    : heatOn
                      ? "alert"
                      : coolOn
                        ? "ready"
                        : powerOn
                          ? "neutral"
                          : "off";
                const processIcon = !enabled
                    ? "⏻"
                    : heatOn
                      ? "🔥"
                      : coolOn
                        ? "❄️"
                        : "◌";
                const powerWritable = controllerAccess(
                    detail,
                    "thermo",
                    id,
                    "power",
                ).write;
                const modeWritable = controllerAccess(
                    detail,
                    "thermo",
                    id,
                    "mode",
                ).write;
                const targetWritable = controllerAccess(
                    detail,
                    "thermo",
                    id,
                    "target",
                ).write;
                return `
        <article class="tile thermo-card ${enabled && (powerWritable || modeWritable || targetWritable) ? "" : "disabled"}" data-thermo-id="${id}" data-power-on="${powerOn ? "1" : "0"}" data-mode="${esc(mode)}" data-target="${Number.isFinite(target) ? Math.round(target) : ""}">
          <div class="thermo-left">
            <div class="thermo-visual">
              <span class="socket-chip">#${id}</span>
              <span class="temp-pill sensor">Датчик: <span class="temp-value">${esc(sensorText)}</span>&deg;C</span>
              ${thermoStatusVisualSvg(mode, heatOn, coolOn)}
              <span class="temp-pill target">Цель: <span class="temp-value">${esc(targetText)}</span>&deg;C</span>
            </div>
            <div class="thermo-temp-summary">
              <span class="metric-chip ${Number.isFinite(sensor) ? "is-running" : "is-off"}">
                <span class="metric-label">Сейчас</span>
                <span class="metric-value">${esc(sensorText)}&deg;C</span>
              </span>
              <span class="metric-chip ${powerOn ? "is-hot" : "is-off"}">
                <span class="metric-label">Цель</span>
                <span class="metric-value">${esc(targetText)}&deg;C</span>
              </span>
            </div>
          </div>
          <div class="socket-main">
            <div class="socket-head">
              <div class="socket-name">${esc(item?.name || `Термо ${id}`)}</div>
              ${onOffDot(enabled)}
            </div>
            <div class="thermo-status-row">
              ${statusBadge(`${processIcon} ${processText}`, processBadgeTone)}
              <span class="thermo-mode-pill ${enabled ? "is-active" : "is-off"}">
                <span class="thermo-mode-icon" aria-hidden="true">${modeIcon(mode)}</span>
                <span>${esc(modeLabel(mode))}</span>
              </span>
            </div>
            <div class="thermo-indicators">
              <span class="thermo-indicator ${powerOn ? "is-active" : "is-idle"}">
                <span class="thermo-indicator-dot" aria-hidden="true"></span>
                <span class="thermo-indicator-label">Питание</span>
              </span>
              <span class="thermo-indicator ${heatOn ? "is-hot" : "is-idle"}">
                <span class="thermo-indicator-dot" aria-hidden="true"></span>
                <span class="thermo-indicator-label">Нагрев</span>
              </span>
              <span class="thermo-indicator ${coolOn ? "is-cool" : "is-idle"}">
                <span class="thermo-indicator-dot" aria-hidden="true"></span>
                <span class="thermo-indicator-label">Охлаждение</span>
              </span>
              <span class="thermo-indicator ${enabled ? "is-ready" : "is-disabled"}">
                <span class="thermo-indicator-dot" aria-hidden="true"></span>
                <span class="thermo-indicator-label">${enabled ? "Контур активен" : "Контур отключен"}</span>
              </span>
            </div>
            <div class="socket-meta thermo-meta-line">
              <span class="badge">ID ${id}</span>
              <span class="meta-value">Режим работы: ${esc(modeLabel(mode))}</span>
            </div>
            <div class="socket-meta thermo-meta-line">
              <span class="meta-value">${esc(sensorLabel)}</span>
              <span class="meta-value">${sensorHasTemp ? `Температура: ${esc(sensorText)}°C` : "Температура: нет данных"}</span>
            </div>
            <div class="socket-actions thermo-actions-grid">
              <button class="ghost btn-sm thermo-power-btn ${powerOn ? "btn-off" : "btn-on"}" data-action="power-toggle" ${enabled && powerWritable ? "" : "disabled"}>
                ${powerOn ? "⏻ Выключить" : "⏻ Включить"}
              </button>
              <button class="ghost btn-sm thermo-mode-btn" data-action="mode-cycle" ${enabled && modeWritable ? "" : "disabled"}>
                ${modeIcon(mode)} Сменить режим
              </button>
              <div class="thermo-adjust-group">
                <button class="ghost btn-sm thermo-step-btn" data-action="target-down" ${enabled && targetWritable ? "" : "disabled"} aria-label="Уменьшить целевую температуру">−1</button>
                <div class="thermo-target-chip">
                  <span class="thermo-target-label">Цель</span>
                  <span class="thermo-target-value">${esc(targetText)}&deg;C</span>
                </div>
                <button class="ghost btn-sm thermo-step-btn" data-action="target-up" ${enabled && targetWritable ? "" : "disabled"} aria-label="Увеличить целевую температуру">+1</button>
              </div>
            </div>
          </div>
        </article>
      `;
            })
            .join("");
    }

    renderSeptic(detail) {
        if (!this.deviceSepticGrid) return;
        const list = asArray(detail?.controllers?.septic);
        if (!list.length) {
            this.deviceSepticGrid.innerHTML = this.renderEmptyState(
                "Нет данных по септику",
            );
            return;
        }
        this.deviceSepticGrid.innerHTML = list
            .map((item) => {
                const id = Number(item?.id);
                const enabled = Boolean(item?.enabled);
                const writable = controllerAccess(
                    detail,
                    "septic",
                    id,
                    "monitor",
                ).write;
                const monitor = Boolean(
                    item?.monitoring_on ?? item?.monitor_on,
                );
                const warning = Boolean(item?.warning);
                const alarm = Boolean(item?.alarm);
                const levelClass = alarm
                    ? "water-alarm"
                    : warning
                      ? "water-warn"
                      : "water-low";
                const levelText = alarm
                    ? "АВАРИЯ"
                    : warning
                      ? "ВНИМАНИЕ"
                      : "НОРМА";
                return `
        <article class="tile ${enabled && writable ? "" : "disabled"}" data-septic-id="${id}" data-monitor="${monitor ? "1" : "0"}">
          <div class="thermo-left">
            <div class="septic-visual">
              <span class="socket-chip">#${id}</span>
              <div class="liquid ${levelClass}" style="height:${alarm ? "82%" : warning ? "55%" : "28%"};"></div>
              <span class="level-label">${levelText}</span>
              <svg class="icon ${alarm ? "active" : "inactive"}" viewBox="0 0 64 64" aria-hidden="true">
                <rect x="12" y="10" width="40" height="44" rx="6"></rect>
                <path d="M20 30h24M20 38h24"/>
              </svg>
            </div>
            <div class="status-line">
              <span class="status-dot ${alarm ? "status-err" : warning ? "status-cool" : "status-on"}"></span>
              <span class="status-value">${alarm ? "Тревога" : warning ? "Предупреждение" : "Норма"}</span>
              <span class="badge">#${id}</span>
            </div>
          </div>
          <div class="socket-main">
            <div class="socket-head">
              <div class="socket-name">${esc(item?.name || `Септик ${id}`)}</div>
              ${onOffDot(enabled)}
            </div>
            <div class="mini-state-grid">
              <div class="mini-state-item ${monitor ? "is-on" : "is-off"}">
                <span class="mini-state-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M7 12h10"></path>
                    <path d="M12 7v10"></path>
                    <circle cx="12" cy="12" r="7"></circle>
                  </svg>
                </span>
                <span class="mini-state-label">Мониторинг</span>
                <span class="mini-state-value">${monitor ? "ВКЛ" : "ВЫКЛ"}</span>
              </div>
              <div class="mini-state-item ${warning ? "is-warn" : "is-off"}">
                <span class="mini-state-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M12 4 20 19H4Z"></path>
                    <path d="M12 9v4"></path>
                    <circle cx="12" cy="16.5" r="0.8" class="mini-state-fill"></circle>
                  </svg>
                </span>
                <span class="mini-state-label">Предупреждение</span>
                <span class="mini-state-value">${warning ? "ВКЛ" : "ВЫКЛ"}</span>
              </div>
              <div class="mini-state-item ${alarm ? "is-alarm" : "is-ok"}">
                <span class="mini-state-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M12 4 20 19H4Z"></path>
                    <path d="M12 9v4"></path>
                    <circle cx="12" cy="16.5" r="0.8" class="mini-state-fill"></circle>
                  </svg>
                </span>
                <span class="mini-state-label">Авария</span>
                <span class="mini-state-value">${alarm ? "ВКЛ" : "ВЫКЛ"}</span>
              </div>
            </div>
            <div class="socket-actions action-row">
              <button class="ghost btn-sm ${monitor ? "btn-off" : "btn-on"}" data-action="monitor-toggle" ${enabled && writable ? "" : "disabled"}>${monitor ? "Мониторинг ВЫКЛ" : "Мониторинг ВКЛ"}</button>
            </div>
          </div>
        </article>
      `;
            })
            .join("");
    }

    renderWatering(detail) {
        if (!this.deviceWateringGrid) return;
        const list = asArray(detail?.controllers?.watering);
        if (!list.length) {
            this.deviceWateringGrid.innerHTML = this.renderEmptyState(
                stackControllerPending(detail, "watering")
                    ? "Идёт загрузка правил полива со слейва"
                    : "Нет данных по поливу",
            );
            return;
        }
        this.deviceWateringGrid.innerHTML = list
            .map((item) => {
                const id = Number(item?.id);
                const enabled = Boolean(item?.enabled);
                const powerWritable = controllerAccess(
                    detail,
                    "watering",
                    id,
                    "status",
                ).write;
                const forceWritable = controllerAccess(
                    detail,
                    "watering",
                    id,
                    "force",
                ).write;
                const writable = powerWritable || forceWritable;
                const powerOn = Boolean(item?.status);
                const force = Boolean(item?.force);
                const active = force || (powerOn && Boolean(item?.active));
                const paused = !force && powerOn && Boolean(item?.paused);
                const resume = Boolean(item?.resume);
                const weekdaysMask = wateringWeekdaysMask(item);
                const activeDays = wateringWeekdayList(weekdaysMask);
                const left = Number(
                    item?.left_min ?? item?.left ?? item?.minutes_left,
                );
                const leftText =
                    Number.isFinite(left) && left >= 0
                        ? `${Math.round(left)} мин`
                        : "-";
                const tankName = String(item?.tank_name || "").trim();
                const tankId = Number(item?.tank);
                const tankLabel =
                    tankName ||
                    (Number.isFinite(tankId) && tankId > 0
                        ? `Бак #${tankId}`
                        : "не привязан");
                const weekdayButtons = [
                    { bit: 1, label: "Пн" },
                    { bit: 2, label: "Вт" },
                    { bit: 3, label: "Ср" },
                    { bit: 4, label: "Чт" },
                    { bit: 5, label: "Пт" },
                    { bit: 6, label: "Сб" },
                    { bit: 0, label: "Вс" },
                ]
                    .map((day) => {
                        const checked = (weekdaysMask & (1 << day.bit)) !== 0;
                        return `
              <button
                class="weekday-toggle ${checked ? "is-active" : ""}"
                type="button"
                data-action="weekday-toggle"
                data-bit="${day.bit}"
                ${enabled && writable ? "" : "disabled"}
              >${checked ? "☑" : "☐"} ${day.label}</button>
            `;
                    })
                    .join("");
                const slots = [
                    {
                        slot: 1,
                        enabled: Boolean(item?.slot1_enabled),
                        hour: Number(item?.hour),
                        minute: Number(item?.minute),
                        duration_s: Number(item?.duration_s),
                    },
                    {
                        slot: 2,
                        enabled: Boolean(item?.slot2_enabled),
                        hour: Number(item?.hour2),
                        minute: Number(item?.minute2),
                        duration_s: Number(item?.duration2_s),
                    },
                    {
                        slot: 3,
                        enabled: Boolean(item?.slot3_enabled),
                        hour: Number(item?.hour3),
                        minute: Number(item?.minute3),
                        duration_s: Number(item?.duration3_s),
                    },
                ];
                const scheduleSummary = slots
                    .filter((slot) => wateringSlotConfigured(slot))
                    .map(
                        (slot) =>
                            `${slot.slot}: ${wateringTimeLabel(slot.hour, slot.minute)} · ${wateringDurationLabel(slot.duration_s)}`,
                    )
                    .join("  •  ");
                const slotsMarkup = slots
                    .map((slot) => {
                        const timeText = wateringTimeLabel(
                            slot.hour,
                            slot.minute,
                        );
                        const durationText = wateringDurationLabel(
                            slot.duration_s,
                        );
                        const timeValue =
                            timeText === "--:--" ? "00:00" : timeText;
                        const durationMinutes = Math.max(
                            0,
                            Math.round(
                                (Number.isFinite(slot.duration_s)
                                    ? slot.duration_s
                                    : 0) / 60,
                            ),
                        );
                        const configured = wateringSlotConfigured(slot);
                        const copyTargets = [1, 2, 3]
                            .filter((targetSlot) => targetSlot !== slot.slot)
                            .map(
                                (targetSlot) => `
                      <button class="ghost btn-sm watering-copy-btn" type="button" data-action="slot-copy" data-slot="${slot.slot}" data-target-slot="${targetSlot}" ${enabled && writable ? "" : "disabled"}>В слот ${targetSlot}</button>
                    `,
                            )
                            .join("");
                        return `
              <div
                class="watering-slot-card ${configured ? "is-configured" : ""}"
                data-watering-slot="${slot.slot}"
                data-enabled="${slot.enabled ? "1" : "0"}"
                data-hour="${Number.isFinite(slot.hour) ? slot.hour : 0}"
                data-minute="${Number.isFinite(slot.minute) ? slot.minute : 0}"
                data-duration-s="${Number.isFinite(slot.duration_s) ? slot.duration_s : 0}"
              >
                <div class="watering-slot-head">
                  <span class="watering-slot-title">Слот ${slot.slot}</span>
                  <span class="watering-slot-value">${esc(timeText)} · ${esc(durationText)}</span>
                </div>
                <div class="watering-slot-state">${
                    slot.enabled ? (configured ? "Настроен" : "Включён") : "Отключен"
                }</div>
                <div class="watering-slot-editor">
                  <label class="watering-slot-time">
                    <span class="watering-slot-caption">Время старта</span>
                    <input class="watering-time-input" type="time" value="${esc(timeValue)}" step="60" ${enabled && writable ? "" : "disabled"} />
                  </label>
                  <label class="watering-slot-duration">
                    <span class="watering-slot-caption">Длительность, мин</span>
                    <div class="watering-duration-editor">
                      <button class="ghost btn-sm watering-duration-step" type="button" data-action="slot-duration-step" data-slot="${slot.slot}" data-duration-delta="-1" ${enabled && writable ? "" : "disabled"}>−</button>
                      <input class="watering-duration-input" type="number" min="0" step="1" value="${durationMinutes}" ${enabled && writable ? "" : "disabled"} />
                      <button class="ghost btn-sm watering-duration-step" type="button" data-action="slot-duration-step" data-slot="${slot.slot}" data-duration-delta="1" ${enabled && writable ? "" : "disabled"}>+</button>
                    </div>
                  </label>
                </div>
                <div class="watering-slot-actions">
                  <button class="ghost btn-sm watering-enable-btn" type="button" data-action="slot-enabled-toggle" data-slot="${slot.slot}" ${enabled && writable ? "" : "disabled"}>${slot.enabled ? "🟢 Слот" : "⚪ Слот"}</button>
                  <button class="ghost btn-sm watering-save-btn" type="button" data-action="slot-save" data-slot="${slot.slot}" ${enabled && writable ? "" : "disabled"}>Сохранить слот</button>
                </div>
                <div class="watering-slot-copy-row">
                  ${copyTargets}
                </div>
              </div>
            `;
                    })
                    .join("");
                return `
        <article class="tile watering-item ${enabled && writable ? "" : "disabled"}" data-watering-id="${id}" data-status="${powerOn ? "1" : "0"}" data-force="${force ? "1" : "0"}" data-active="${active ? "1" : "0"}" data-weekdays-mask="${weekdaysMask}">
          <div class="thermo-left">
            <div class="watering-visual">
              <span class="socket-chip">#${id}</span>
              <svg class="watering-icon" viewBox="0 0 64 64" aria-hidden="true">
                <path d="M8 34h20v10h8V34h8c6 0 12 5 12 12v2"/>
                <path d="M56 52c0 4-3 6-6 6s-6-2-6-6c0-4 6-10 6-10s6 6 6 10z"/>
              </svg>
              <span class="level-label">${force ? "ПОЛИВ" : active ? "РАБОТА" : paused ? "ПАУЗА" : "ПРОСТОЙ"}</span>
            </div>
            <div class="status-line">
              <span class="status-dot ${(active || force) ? "status-on" : "status-idle"}"></span>
              <span class="status-value">${force ? "Ручной полив" : !powerOn ? "Выключен" : active ? "Активен" : paused ? "Ожидание бака" : "Ожидание времени"}</span>
              <span class="badge">#${id}</span>
            </div>
          </div>
          <div class="socket-main">
            <div class="socket-head">
              <div class="socket-name">${esc(item?.name || `Полив ${id}`)}</div>
              ${onOffDot(enabled)}
            </div>
            <div class="metric-grid">
              <span class="metric-chip ${powerOn ? "is-on" : "is-off"}"><span class="metric-label">Питание</span><span class="metric-value">${powerOn ? "ВКЛ" : "ВЫКЛ"}</span></span>
              <span class="metric-chip ${active ? "is-on" : paused ? "is-warn" : "is-off"}"><span class="metric-label">Статус</span><span class="metric-value">${force ? "ПОЛИВ" : !powerOn ? "ВЫКЛ" : active ? "АКТИВЕН" : paused ? "БАК" : "ВРЕМЯ"}</span></span>
              <span class="metric-chip ${resume ? "is-running" : "is-off"}"><span class="metric-label">Возобновление</span><span class="metric-value">${resume ? "ВКЛ" : "ВЫКЛ"}</span></span>
              <span class="metric-chip is-off"><span class="metric-label">Осталось</span><span class="metric-value">${esc(leftText)}</span></span>
            </div>
            <div class="watering-schedule-summary">
              <span class="watering-summary-chip"><span class="metric-label">Дни</span><span class="metric-value">${esc(activeDays.length ? activeDays.join(", ") : "не выбраны")}</span></span>
              <span class="watering-summary-chip watering-summary-chip-wide"><span class="metric-label">Расписание</span><span class="metric-value">${esc(scheduleSummary || "слоты пока не заданы")}</span></span>
              <span class="watering-summary-chip"><span class="metric-label">Бак</span><span class="metric-value">${esc(tankLabel)}</span></span>
            </div>
            <div class="watering-weekdays">
              ${weekdayButtons}
            </div>
            <div class="watering-slots">
              ${slotsMarkup}
            </div>
            <div class="socket-actions action-row">
              <button class="ghost btn-sm ${powerOn ? "btn-off" : "btn-on"}" data-action="status-toggle" ${enabled && powerWritable ? "" : "disabled"}>${powerOn ? "⚪ Питание" : "🟢 Питание"}</button>
              <button class="ghost btn-sm ${force ? "btn-off" : "btn-on"}" data-action="force-toggle" ${enabled && forceWritable ? "" : "disabled"}>${force ? "🚰 Не поливать" : "🚰 Полить"}</button>
            </div>
          </div>
        </article>
      `;
            })
            .join("");
    }

    renderRules(detail) {
        if (!this.deviceRulesGrid) return;
        const list = asArray(detail?.controllers?.rules).filter(
            (item) => Number(item?.id) > 0,
        );
        if (!list.length) {
            this.deviceRulesGrid.innerHTML = this.renderEmptyState(
                stackControllerPending(detail, "rules")
                    ? "Идёт загрузка правил со слейва"
                    : "Нет доступных правил",
                "Обновить",
            );
            return;
        }
        this.deviceRulesGrid.innerHTML = list
            .map((item) => {
                const id = Number(item?.id);
                const access = controllerAccess(detail, "rules", id, "run");
                const writable = access.write;
                const name = String(item?.name || "").trim() || `Правило ${id}`;
                const description = String(item?.description || "").trim();
                return `
        <article class="tile ${writable ? "" : "disabled"}" data-rule-id="${id}">
          <div class="tile-head">
            <div>
              <div class="tile-title">📜 ${esc(name)}</div>
              <div class="tile-sub">${description ? esc(description) : `ID: ${id}`}</div>
            </div>
            ${statusBadge(writable ? "Готово" : "Нет доступа", writable ? "ok" : "muted")}
          </div>
          <div class="socket-actions action-row">
            <button class="ghost btn-sm ${writable ? "btn-on" : ""}" type="button" data-action="run" ${writable ? "" : "disabled"}>Выполнить</button>
          </div>
        </article>
      `;
            })
            .join("");
    }

    renderRing(detail) {
        if (!this.deviceRingWrap) return;
        const ring = detail?.controllers?.ring || null;
        if (!ring || typeof ring !== "object") {
            this.deviceRingWrap.innerHTML = this.renderEmptyState(
                "Нет данных по звонку",
            );
            return;
        }
        const enabled = Boolean(ring.enabled);
        const writable = controllerAccess(detail, "ring", null, "hold").write;
        const relayOn = Boolean(ring.relay_on ?? ring.hold_on);
        const buttonOn = Boolean(ring.button_on ?? ring.button);
        this.deviceRingWrap.innerHTML = `
      <article class="ring-card ${enabled && writable ? "" : "disabled"}">
        <div class="ring-head">
          <span class="pill">Статус: ${enabled ? "доступен" : "отключен"}</span>
        </div>
        <div class="state-indicators">
          <span class="state-item"><span class="state-dot ${relayOn ? "net-on" : ""}"></span> Реле: <strong>${relayOn ? "ВКЛ" : "ВЫКЛ"}</strong></span>
          <span class="state-item"><span class="state-dot ${buttonOn ? "net-on" : ""}"></span> Кнопка: <strong>${buttonOn ? "ВКЛ" : "ВЫКЛ"}</strong></span>
        </div>
        <div class="socket-actions">
          <button class="ghost btn-sm ${relayOn ? "btn-off" : "btn-on"}" data-action="ring-hold" ${enabled && writable ? "" : "disabled"}>${relayOn ? "Удержание ВКЛ" : "Удержание ВЫКЛ"}</button>
        </div>
      </article>
    `;
    }

    renderAvr(detail) {
        if (!this.deviceAvrWrap) return;
        const avr = detail?.controllers?.avr || null;
        if (!avr || typeof avr !== "object") {
            this.deviceAvrWrap.innerHTML =
                this.renderEmptyState("Нет данных по АВР");
            return;
        }
        const enabled = Boolean(avr.enabled);
        const autoWritable = controllerAccess(
            detail,
            "avr",
            null,
            "auto",
        ).write;
        const sourceWritable = controllerAccess(
            detail,
            "avr",
            null,
            "source",
        ).write;
        const clearWritable = controllerAccess(
            detail,
            "avr",
            null,
            "clear_fault",
        ).write;
        const autoMode = Boolean(avr.auto_mode ?? avr.auto);
        const active = String(avr.active_source || avr.source || "-");
        const source1 = String(avr.source1 || "основной");
        const source2 = String(avr.source2 || "резерв");
        const fault = String(avr.fault || "none");
        const faultActive = fault !== "none" && fault !== "ok" && fault !== "-";
        this.deviceAvrWrap.innerHTML = `
      <article class="avr-card ${enabled && (autoWritable || sourceWritable || clearWritable) ? "" : "disabled"}" data-auto-mode="${autoMode ? "1" : "0"}">
        <div class="mini-state-grid avr-top-grid">
          <div class="mini-state-item ${autoMode ? "is-on" : "is-off"}">
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
            <span class="mini-state-value">${autoMode ? "ВКЛ" : "ВЫКЛ"}</span>
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
          <div class="mini-state-item ${faultActive ? "is-alarm" : "is-ok"}">
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
          <button class="ghost btn-sm ${autoMode ? "btn-off" : "btn-on"}" data-action="auto-toggle" ${enabled && autoWritable ? "" : "disabled"}>${autoMode ? "Авто ВЫКЛ" : "Авто ВКЛ"}</button>
          <button class="ghost btn-sm" data-action="source" data-source="${esc(source1)}" ${enabled && sourceWritable ? "" : "disabled"}>${esc(source1)}</button>
          <button class="ghost btn-sm" data-action="source" data-source="${esc(source2)}" ${enabled && sourceWritable ? "" : "disabled"}>${esc(source2)}</button>
          <button class="ghost btn-sm" data-action="clear-fault" ${enabled && clearWritable ? "" : "disabled"}>Сброс аварии</button>
        </div>
      </article>
    `;
    }

    renderLeak(detail) {
        if (!this.deviceLeakGrid) return;
        const list = asArray(detail?.controllers?.leak);
        if (this.deviceLeakActions) {
            this.deviceLeakActions
                .querySelectorAll("button[data-action]")
                .forEach((btn) => {
                    const writable = controllerAccess(
                        detail,
                        "leak",
                        null,
                        btn.dataset.action || "",
                    ).write;
                    btn.disabled = !writable;
                });
        }
        if (!list.length) {
            this.deviceLeakGrid.innerHTML = this.renderEmptyState(
                "Нет данных по протечкам",
            );
            return;
        }
        this.deviceLeakGrid.innerHTML = list
            .map((item) => {
                const id = Number(item?.id);
                const enabled = Boolean(item?.enabled);
                const powerWritable = controllerAccess(
                    detail,
                    "leak",
                    id,
                    "power",
                ).write;
                const ackWritable = controllerAccess(
                    detail,
                    "leak",
                    id,
                    "ack",
                ).write;
                const powerOn = Boolean(item?.power_on);
                const wet = Boolean(item?.wet);
                const alarmLatched = Boolean(
                    item?.alarm_latched ?? item?.alarm,
                );
                const alert = wet || alarmLatched;
                return `
        <article class="tile ${enabled && (powerWritable || ackWritable) ? "" : "disabled"} ${alert ? "alert" : ""}" data-leak-id="${id}" data-power-on="${powerOn ? "1" : "0"}">
          <div class="tile-left">
            <svg class="security-icon leak-icon ${alert ? "alert" : powerOn ? "on" : "off"}" viewBox="0 0 64 64" aria-hidden="true">
              <path d="M32 8c7 12 16 20 16 32 0 8.8-7.2 16-16 16s-16-7.2-16-16c0-12 9-20 16-32z"></path>
              <path d="M24 42c2.5 2.5 5 3.5 8 3.5s5.5-1 8-3.5"></path>
            </svg>
            <span class="tile-id">#${id}</span>
            ${onOffDot(enabled)}
          </div>
          <div class="tile-grid">
            <span class="metric-chip ${powerOn ? "is-on" : "is-off"}"><span class="metric-label">Питание</span><span class="metric-value">${powerOn ? "ВКЛ" : "ВЫКЛ"}</span></span>
            <span class="metric-chip ${wet ? "is-alarm" : "is-off"}"><span class="metric-label">Влага</span><span class="metric-value">${wet ? "ДА" : "НЕТ"}</span></span>
            <span class="metric-chip ${alarmLatched ? "is-warn" : "is-off"}"><span class="metric-label">Фиксация</span><span class="metric-value">${alarmLatched ? "ДА" : "НЕТ"}</span></span>
          </div>
          <div class="socket-actions">
            <button class="ghost btn-sm ${powerOn ? "btn-off" : "btn-on"}" data-action="power-toggle" ${enabled && powerWritable ? "" : "disabled"}>${powerOn ? "Питание ВЫКЛ" : "Питание ВКЛ"}</button>
            <button class="ghost btn-sm" data-action="ack" ${enabled && ackWritable ? "" : "disabled"}>Сброс</button>
          </div>
        </article>
      `;
            })
            .join("");
    }

    renderAdminDevices(devices, objects, onRotate, onDelete, onMoveObject) {
        this.adminDevices.innerHTML = "";
        if (!devices.length) {
            this.adminDevices.textContent = "Нет устройств";
            return;
        }
        for (const device of devices) {
            const row = document.createElement("div");
            row.className = "admin-row";
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
            <div><strong>${device.name || "Без имени"}</strong> (#${device.device_id})</div>
          </div>
          <div class="muted">${device.object_name} · ${device.online ? "онлайн" : "оффлайн"}</div>
          <div class="key">API-ключ: ${device.api_key}</div>
        </div>
      `;
            const actions = document.createElement("div");
            actions.className = "admin-actions";
            const objectSelect = document.createElement("select");
            objectSelect.className = "admin-object-select";
            for (const objectName of objects) {
                const opt = document.createElement("option");
                opt.value = objectName;
                opt.textContent = objectName;
                objectSelect.appendChild(opt);
            }
            const canMove = objects.length > 0;
            objectSelect.disabled = !canMove;
            if (objects.includes(device.object_name)) {
                objectSelect.value = device.object_name;
            }
            objectSelect.addEventListener("change", () =>
                onMoveObject(device, objectSelect.value),
            );
            const rotate = document.createElement("button");
            rotate.className = "ghost";
            rotate.textContent = "Сменить ключ";
            rotate.addEventListener("click", () => onRotate(device));
            const del = document.createElement("button");
            del.className = "ghost danger";
            del.textContent = "Удалить";
            del.addEventListener("click", () => onDelete(device));
            actions.appendChild(objectSelect);
            actions.appendChild(rotate);
            actions.appendChild(del);
            row.appendChild(actions);
            this.adminDevices.appendChild(row);
        }
    }

    renderAdminObjects(objects, onDelete, onRename, onIconChange) {
        this.adminObjects.innerHTML = "";
        if (!objects.length) {
            this.adminObjects.textContent = "Нет объектов";
            return;
        }
        for (const raw of objects) {
            const objectItem = normalizeObjectItem(raw);
            const objectName = objectItem.name;
            const row = document.createElement("div");
            row.className = "admin-row";
            row.innerHTML = `
        <div class="admin-main">
          <div class="admin-object-head">
            <span class="admin-object-preview">${objectIconSvg(objectItem.icon)}</span>
            <strong>${esc(objectName)}</strong>
          </div>
        </div>
      `;
            const actions = document.createElement("div");
            actions.className = "admin-actions";
            const iconSelect = document.createElement("select");
            iconSelect.className = "admin-object-select";
            for (const option of OBJECT_ICON_OPTIONS) {
                const opt = document.createElement("option");
                opt.value = option.value;
                opt.textContent = option.label;
                iconSelect.appendChild(opt);
            }
            iconSelect.value = OBJECT_ICON_OPTIONS.some(
                (row) => row.value === objectItem.icon,
            )
                ? objectItem.icon
                : "house";
            iconSelect.addEventListener("change", () =>
                onIconChange(objectName, iconSelect.value),
            );
            const rename = document.createElement("button");
            rename.className = "ghost";
            rename.textContent = "Переименовать";
            rename.addEventListener("click", () => onRename(objectName));
            const del = document.createElement("button");
            del.className = "ghost danger";
            del.textContent = "Удалить";
            del.addEventListener("click", () => onDelete(objectName));
            actions.appendChild(iconSelect);
            actions.appendChild(rename);
            actions.appendChild(del);
            row.appendChild(actions);
            this.adminObjects.appendChild(row);
        }
    }

    renderTelegramSettings(settings) {
        if (this.telegramSettingsForm) {
            const tokenInput =
                this.telegramSettingsForm.elements.namedItem("token");
            if (tokenInput) tokenInput.value = settings?.token || "";
        }
        if (!this.telegramSettingsInfo) return;
        if (!settings) {
            this.telegramSettingsInfo.innerHTML =
                '<div class="admin-row">Нет данных по Telegram-боту</div>';
            return;
        }
        const infoRows = [
            {
                label: "Состояние",
                value: settings.enabled ? "Бот активен" : "Бот выключен",
                meta: settings.enabled
                    ? "Polling запущен и готов принимать сообщения"
                    : "Укажи token и сохрани настройки",
                tone: settings.enabled ? "ready" : "neutral",
            },
            {
                label: "Режим",
                value:
                    settings.transport === "long_polling"
                        ? "Long polling"
                        : "-",
                meta: "Telegram обновления обрабатываются напрямую с сервера",
                tone: "neutral",
            },
            {
                label: "Token",
                value: settings.token_configured ? "Задан" : "Не задан",
                meta: settings.token_configured
                    ? "Bot token сохранен в конфигурации"
                    : "Без token бот не запускается",
                tone: settings.token_configured ? "ready" : "alert",
            },
            {
                label: "Username бота",
                value: settings.bot_username
                    ? `@${settings.bot_username}`
                    : "-",
                meta:
                    settings.bot_name ||
                    "Имя будет получено после успешного запуска",
                tone: settings.bot_username ? "on" : "neutral",
            },
            {
                label: "Last Chat ID",
                value: settings.last_chat_id || "—",
                meta: settings.last_chat_id
                    ? `Последний пользователь: ${settings.last_chat_username ? `@${settings.last_chat_username}` : "без username"}`
                    : "Появится после первого сообщения или нажатия кнопки в Telegram",
                tone: settings.last_chat_id ? "ready" : "neutral",
                copyValue: settings.last_chat_id || "",
                extraMeta: settings.last_chat_seen_at
                    ? `Обновлено: ${new Date(settings.last_chat_seen_at).toLocaleString("ru-RU")}`
                    : "",
            },
        ];
        this.telegramSettingsInfo.innerHTML = infoRows
            .map(
                (row) => `
      <div class="telegram-info-card">
        <div class="telegram-info-top">
          <div class="telegram-info-label">${esc(row.label)}</div>
          ${statusBadge(row.tone === "ready" ? "OK" : row.tone === "alert" ? "Внимание" : "Инфо", row.tone)}
        </div>
        <div class="telegram-info-value">${esc(row.value)}</div>
        <div class="telegram-info-meta">${esc(row.meta)}</div>
        ${row.copyValue ? `<input class="telegram-copy-input" type="text" readonly value="${esc(row.copyValue)}" />` : ""}
        ${row.extraMeta ? `<div class="telegram-info-meta telegram-info-meta-secondary">${esc(row.extraMeta)}</div>` : ""}
      </div>
    `,
            )
            .join("");
    }

    renderUserObjectSelector(objects, selected = []) {
        if (!this.userAllowedObjects) return;
        this.userAllowedObjects.innerHTML = "";
        const selectedSet = new Set(
            Array.isArray(selected) ? selected.map((item) => String(item)) : [],
        );
        const list = Array.isArray(objects) ? objects : [];
        if (!list.length) {
            this.userAllowedObjects.textContent = "Нет объектов";
            return;
        }
        for (const objectItem of list) {
            const name = String(
                typeof objectItem === "string"
                    ? objectItem
                    : objectItem?.name || "",
            ).trim();
            if (!name) continue;
            const line = document.createElement("label");
            line.style.display = "inline-flex";
            line.style.alignItems = "center";
            line.style.gap = "8px";
            line.style.margin = "0 12px 8px 0";
            const input = document.createElement("input");
            input.type = "checkbox";
            input.name = "allowed_objects";
            input.value = name;
            input.checked = selectedSet.has(name);
            const text = document.createElement("span");
            text.textContent = name;
            line.appendChild(input);
            line.appendChild(text);
            this.userAllowedObjects.appendChild(line);
        }
    }

    renderAdminUsers(users, objects, notificationCatalog, onSave, onDelete) {
        if (!this.adminUsers) return;
        this.adminUsers.innerHTML = "";
        if (!users.length) {
            this.adminUsers.textContent = "Нет пользователей";
            return;
        }
        for (const user of users) {
            const row = document.createElement("div");
            row.className = "admin-row admin-user-card";
            const title = document.createElement("div");
            title.className = "admin-user-card-title";
            title.innerHTML = `
        <span class="admin-user-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/>
            <path d="M5 20c1.3-3.9 4.3-6 7-6s5.7 2.1 7 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </span>
        <strong>${esc(user.username || "")}</strong>
      `;
            const fields = document.createElement("div");
            fields.className = "admin-user-fields";
            const usernameInput = document.createElement("input");
            usernameInput.type = "text";
            usernameInput.className = "admin-object-select";
            usernameInput.placeholder = "Логин";
            usernameInput.value = user.username || "";
            const plcInput = document.createElement("input");
            plcInput.type = "text";
            plcInput.className = "admin-object-select";
            plcInput.placeholder = "PLC username";
            plcInput.value = user.plc_username || "";
            const tgInput = document.createElement("input");
            tgInput.type = "text";
            tgInput.className = "admin-object-select";
            tgInput.placeholder = "Telegram username";
            tgInput.value = user.telegram_username || "";
            const chatIdInput = document.createElement("input");
            chatIdInput.type = "text";
            chatIdInput.className = "admin-object-select";
            chatIdInput.placeholder = "Chat ID";
            chatIdInput.value = user.chat_id || "";
            const notifyOnlineInput = document.createElement("input");
            notifyOnlineInput.type = "checkbox";
            const notifyOfflineInput = document.createElement("input");
            notifyOfflineInput.type = "checkbox";
            const notifyEventsInput = document.createElement("input");
            notifyEventsInput.type = "checkbox";
            notifyEventsInput.checked = Boolean(user.telegram_notify_events);
            const rawNotificationPrefs = Array.isArray(user.notification_prefs)
                ? user.notification_prefs.map((item) => String(item))
                : [];
            const notificationPrefs = new Set(rawNotificationPrefs);
            const stackNodeOnlineKey = "stack.node.online";
            const stackNodeOfflineKey = "stack.node.offline";
            notifyOnlineInput.checked =
                Boolean(user.telegram_notify_online) ||
                notificationPrefs.has(stackNodeOnlineKey);
            notifyOfflineInput.checked =
                Boolean(user.telegram_notify_offline) ||
                notificationPrefs.has(stackNodeOfflineKey);
            const useAllNotificationItems = rawNotificationPrefs.length === 0;
            const objectNames = Array.isArray(objects) ? objects : [];
            const allowedObjectSet = new Set(
                Array.isArray(user.allowed_objects)
                    ? user.allowed_objects.map((item) => String(item))
                    : [],
            );
            const passwordInput = document.createElement("input");
            passwordInput.type = "password";
            passwordInput.className = "admin-object-select";
            passwordInput.placeholder = "Новый пароль";
            const usernameField = document.createElement("label");
            usernameField.className = "admin-edit-field";
            usernameField.innerHTML = "<span>Логин</span>";
            usernameField.appendChild(usernameInput);
            const plcField = document.createElement("label");
            plcField.className = "admin-edit-field";
            plcField.innerHTML = "<span>PLC username</span>";
            plcField.appendChild(plcInput);
            const tgField = document.createElement("label");
            tgField.className = "admin-edit-field";
            tgField.innerHTML = "<span>Telegram username</span>";
            tgField.appendChild(tgInput);
            const chatField = document.createElement("label");
            chatField.className = "admin-edit-field";
            chatField.innerHTML = "<span>Chat ID</span>";
            chatField.appendChild(chatIdInput);
            const notifyOnlineField = document.createElement("label");
            notifyOnlineField.className = "admin-edit-field";
            notifyOnlineField.innerHTML = "<span>Telegram online</span>";
            notifyOnlineField.appendChild(notifyOnlineInput);
            const notifyOfflineField = document.createElement("label");
            notifyOfflineField.className = "admin-edit-field";
            notifyOfflineField.innerHTML = "<span>Telegram offline</span>";
            notifyOfflineField.appendChild(notifyOfflineInput);
            const notifyEventsField = document.createElement("label");
            notifyEventsField.className = "admin-edit-field";
            notifyEventsField.innerHTML = "<span>Telegram events</span>";
            notifyEventsField.appendChild(notifyEventsInput);
            const notificationGroupsWrap = document.createElement("div");
            notificationGroupsWrap.className =
                "admin-edit-field admin-notify-groups admin-edit-field-wide";
            const notificationGroupsTitle = document.createElement("span");
            notificationGroupsTitle.textContent = "Telegram события";
            notificationGroupsWrap.appendChild(notificationGroupsTitle);
            const notificationToggles = document.createElement("div");
            notificationToggles.className = "admin-notify-basic-grid";
            const toggleCards = [
                [notifyOnlineInput, "Онлайн", "Сообщать о появлении устройства в сети"],
                [notifyOfflineInput, "Оффлайн", "Сообщать о потере связи с устройством"],
                [notifyEventsInput, "События", "Присылать события контроллеров и правил"],
            ];
            for (const [input, titleText, hintText] of toggleCards) {
                const line = document.createElement("label");
                line.className = "admin-notify-basic";
                const textWrap = document.createElement("span");
                textWrap.className = "admin-notify-basic-body";
                textWrap.innerHTML = `
                    <span class="admin-notify-basic-title">${esc(titleText)}</span>
                    <span class="admin-notify-basic-text">${esc(hintText)}</span>
                `;
                line.appendChild(input);
                line.appendChild(textWrap);
                notificationToggles.appendChild(line);
            }
            notificationGroupsWrap.appendChild(notificationToggles);
            const notificationGroupsGrid = document.createElement("div");
            notificationGroupsGrid.className = "admin-notify-groups-grid";
            const notificationInputs = [];
            for (const group of Array.isArray(notificationCatalog)
                ? notificationCatalog
                : []) {
                if (String(group?.key || "") === "device") continue;
                const items = Array.isArray(group?.items) ? group.items : [];
                if (!items.length) continue;
                const box = document.createElement("div");
                box.className = "admin-notify-group";
                const head = document.createElement("div");
                head.className = "admin-notify-group-title";
                head.textContent = String(group.title || group.key || "События");
                box.appendChild(head);
                const checks = document.createElement("div");
                checks.className = "admin-notify-check-grid";
                for (const item of items) {
                    const key = String(item?.key || "").trim();
                    if (!key) continue;
                    if (
                        key === stackNodeOnlineKey ||
                        key === stackNodeOfflineKey
                    ) {
                        continue;
                    }
                    const line = document.createElement("label");
                    line.className = "admin-notify-check";
                    const input = document.createElement("input");
                    input.type = "checkbox";
                    input.checked =
                        useAllNotificationItems || notificationPrefs.has(key);
                    notificationInputs.push(input);
                    input.dataset.notificationKey = key;
                    const text = document.createElement("span");
                    text.textContent = String(item?.title || key);
                    line.appendChild(input);
                    line.appendChild(text);
                    checks.appendChild(line);
                }
                box.appendChild(checks);
                notificationGroupsGrid.appendChild(box);
            }
            notificationGroupsWrap.appendChild(notificationGroupsGrid);
            const passwordField = document.createElement("label");
            passwordField.className = "admin-edit-field";
            passwordField.innerHTML = "<span>Новый пароль</span>";
            passwordField.appendChild(passwordInput);
            const objectsField = document.createElement("label");
            objectsField.className = "admin-edit-field admin-edit-field-wide";
            objectsField.innerHTML = "<span>Доступные объекты</span>";
            const objectsWrap = document.createElement("div");
            objectsWrap.className = "admin-check-chip-grid";
            for (const objectItem of objectNames) {
                const name = String(
                    typeof objectItem === "string"
                        ? objectItem
                        : objectItem?.name || "",
                ).trim();
                if (!name) continue;
                const line = document.createElement("label");
                line.className = "admin-check-chip";
                const input = document.createElement("input");
                input.type = "checkbox";
                input.checked = allowedObjectSet.has(name);
                input.dataset.objectName = name;
                const text = document.createElement("span");
                text.textContent = name;
                line.appendChild(input);
                line.appendChild(text);
                objectsWrap.appendChild(line);
            }
            if (!objectsWrap.childElementCount) {
                objectsWrap.textContent = "Нет объектов";
            }
            objectsField.appendChild(objectsWrap);
            const save = document.createElement("button");
            save.className = "ghost";
            save.textContent = "Сохранить";
            save.addEventListener("click", () =>
                {
                    const notificationPrefs = notificationInputs
                        .filter((input) => input.checked)
                        .map((input) => input.dataset.notificationKey)
                        .filter(Boolean);
                    if (notifyOnlineInput.checked) {
                        notificationPrefs.push(stackNodeOnlineKey);
                    }
                    if (notifyOfflineInput.checked) {
                        notificationPrefs.push(stackNodeOfflineKey);
                    }
                    const uniqueNotificationPrefs = Array.from(
                        new Set(notificationPrefs),
                    );
                    onSave(user, {
                        username: usernameInput.value,
                        plc_username: plcInput.value,
                        telegram_username: tgInput.value,
                        chat_id: chatIdInput.value,
                        telegram_notify_online: notifyOnlineInput.checked,
                        telegram_notify_offline: notifyOfflineInput.checked,
                        telegram_notify_events: notifyEventsInput.checked,
                        notification_prefs: uniqueNotificationPrefs,
                        allowed_objects: Array.from(
                            objectsWrap.querySelectorAll("input[type=\"checkbox\"]"),
                        )
                            .filter((input) => input.checked)
                            .map((input) => input.dataset.objectName)
                            .filter(Boolean),
                        password: passwordInput.value,
                    });
                },
            );
            const del = document.createElement("button");
            del.className = "ghost danger";
            del.textContent = "Удалить";
            del.disabled = user.username === "admin";
            del.addEventListener("click", () => onDelete(user));
            const actions = document.createElement("div");
            actions.className = "admin-user-card-actions";
            actions.appendChild(save);
            actions.appendChild(del);
            fields.appendChild(usernameField);
            fields.appendChild(plcField);
            fields.appendChild(tgField);
            fields.appendChild(chatField);
            fields.appendChild(notificationGroupsWrap);
            fields.appendChild(objectsField);
            fields.appendChild(passwordField);
            row.appendChild(title);
            row.appendChild(fields);
            row.appendChild(actions);
            this.adminUsers.appendChild(row);
        }
    }
}
