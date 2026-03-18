export const NOTIFICATION_CATALOG = [
    {
        key: "device",
        title: "Устройство",
        items: [
            { key: "device.online", title: "Онлайн" },
            { key: "device.offline", title: "Оффлайн" },
        ],
    },
    {
        key: "sockets",
        title: "Розетки",
        items: [{ key: "sockets.state.change", title: "Переключение розеток" }],
    },
    {
        key: "lights",
        title: "Освещение",
        items: [{ key: "lights.state.change", title: "Переключение света" }],
    },
    {
        key: "meteo",
        title: "Метео",
        items: [
            { key: "meteo.sensor.alarm", title: "Ошибка датчика" },
            { key: "meteo.sensor.restore", title: "Восстановление датчика" },
        ],
    },
    {
        key: "thermo",
        title: "Термостаты",
        items: [{ key: "thermo.power.change", title: "Питание термостата" }],
    },
    {
        key: "tanks",
        title: "Баки",
        items: [{ key: "tanks.level.empty", title: "Бак пуст" }],
    },
    {
        key: "septic",
        title: "Септик",
        items: [
            { key: "septic.level.warning", title: "Предупреждение" },
            { key: "septic.level.alarm", title: "Тревога" },
        ],
    },
    {
        key: "security",
        title: "Охрана",
        items: [
            { key: "security.arm.armed", title: "Постановка на охрану" },
            { key: "security.arm.disarmed", title: "Снятие с охраны" },
            { key: "security.alarm.alarm", title: "Охранная тревога" },
            { key: "security.alarm.clear", title: "Сброс тревоги" },
            { key: "security.detect.detect", title: "Сработка датчика" },
            { key: "security.detect.silent", title: "Тихая сработка" },
            { key: "security.detect.clear", title: "Очистка сработок" },
        ],
    },
    {
        key: "watering",
        title: "Полив",
        items: [
            { key: "watering.rule.start", title: "Запуск" },
            { key: "watering.rule.pause_empty", title: "Пауза из-за пустого бака" },
            { key: "watering.rule.resume", title: "Возобновление" },
            { key: "watering.rule.stop", title: "Остановка" },
            { key: "watering.rule.stop_empty", title: "Остановка из-за пустого бака" },
            { key: "watering.rule.stop_done", title: "Успешное завершение" },
        ],
    },
    {
        key: "ring",
        title: "Звонок",
        items: [
            { key: "ring.hold.start", title: "Включение звонка" },
            { key: "ring.hold.stop", title: "Выключение звонка" },
        ],
    },
    {
        key: "avr",
        title: "АВР",
        items: [
            { key: "avr.main.lost", title: "Пропал основной ввод" },
            { key: "avr.main.restored", title: "Восстановился основной ввод" },
            { key: "avr.source.change", title: "Переключение источника" },
            { key: "avr.fault.fault", title: "Ошибка АВР" },
        ],
    },
    {
        key: "leak",
        title: "Протечка",
        items: [
            { key: "leak.zone.detect", title: "Обнаружение протечки" },
            { key: "leak.zone.ack", title: "Подтверждение протечки" },
        ],
    },
    {
        key: "rules",
        title: "Правила",
        items: [{ key: "rules.trigger.trigger", title: "Срабатывание правила" }],
    },
    {
        key: "stack",
        title: "Стек",
        items: [
            { key: "stack.node.online", title: "Узел онлайн" },
            { key: "stack.node.offline", title: "Узел оффлайн" },
        ],
    },
];

export function flattenNotificationCatalog() {
    return NOTIFICATION_CATALOG.flatMap((group) =>
        (Array.isArray(group.items) ? group.items : []).map((item) =>
            String(item.key || "").trim(),
        ),
    ).filter(Boolean);
}

export function normalizeNotificationPrefs(raw) {
    const allowed = new Set(flattenNotificationCatalog());
    const source = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.selected)
          ? raw.selected
          : [];
    return source
        .map((item) => String(item || "").trim())
        .filter((item, index, arr) => item && allowed.has(item) && arr.indexOf(item) === index);
}

export function eventPolicyKey(eventPayload = {}) {
    const kind = String(eventPayload?.kind || "").trim();
    const reason = String(eventPayload?.reason || "").trim();
    if (!kind) return "";
    return reason ? `${kind}.${reason}` : kind;
}

export function isEventAllowedByPrefs(eventPayload, prefs) {
    const selected = normalizeNotificationPrefs(prefs);
    if (!selected.length) return true;
    const key = eventPolicyKey(eventPayload);
    return key ? selected.includes(key) : false;
}
