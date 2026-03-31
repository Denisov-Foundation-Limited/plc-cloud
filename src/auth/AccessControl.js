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
const CONTROLLER_KEYS = [
    "quick_actions",
    "sockets",
    "lights",
    "meteo",
    "thermo",
    "tanks",
    "septic",
    "watering",
    "security",
    "cameras",
    "ring",
    "avr",
    "leak",
];

function lower(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function toStringSet(list = []) {
    return new Set(
        asArray(list)
            .map((item) => String(item || "").trim())
            .filter(Boolean),
    );
}

function toLowerStringSet(list = []) {
    return new Set(
        asArray(list)
            .map((item) => lower(item))
            .filter(Boolean),
    );
}

function toNumberSet(list = []) {
    return new Set(
        asArray(list)
            .map((item) => Number(item))
            .filter((item) => Number.isFinite(item)),
    );
}

function normalizeControllerPolicy(raw) {
    if (raw === true) {
        return { read: true, write: true, ids: null, actions: null };
    }
    if (raw === false || !raw || typeof raw !== "object") {
        return { read: false, write: false, ids: null, actions: null };
    }
    return {
        read: raw.read !== false,
        write: Boolean(raw.write),
        ids:
            raw.ids || raw.allowed_ids || raw.channels || raw.items
                ? toNumberSet(
                      raw.ids || raw.allowed_ids || raw.channels || raw.items,
                  )
                : null,
        actions: raw.actions ? toStringSet(raw.actions) : null,
    };
}

function normalizeRule(raw) {
    const permissions =
        raw.permissions && typeof raw.permissions === "object"
            ? raw.permissions
            : {};
    const controllersSource =
        raw.controllers && typeof raw.controllers === "object"
            ? raw.controllers
            : permissions.controllers &&
                typeof permissions.controllers === "object"
              ? permissions.controllers
              : {};
    const controllers = {};
    for (const key of CONTROLLER_KEYS) {
        controllers[key] = normalizeControllerPolicy(controllersSource[key]);
    }
    return {
        usernames: new Set(
            [
                lower(raw.plc_username),
                lower(raw.username),
                lower(raw.user),
                lower(raw.uid),
                ...asArray(raw.usernames).map(lower),
                ...asArray(raw.plc_usernames).map(lower),
            ].filter(Boolean),
        ),
        objects: toLowerStringSet(
            raw.objects || raw.object_names || raw.allowed_objects,
        ),
        deviceIds: toNumberSet(
            raw.devices || raw.device_ids || raw.allowed_devices,
        ),
        readAll: Boolean(raw.read_all ?? permissions.read_all),
        writeAll: Boolean(raw.write_all ?? permissions.write_all),
        statusRead: Boolean(
            raw.status?.read ??
            permissions.status?.read ??
            raw.read_all ??
            permissions.read_all,
        ),
        networkRead: Boolean(
            raw.network?.read ??
            permissions.network?.read ??
            raw.read_all ??
            permissions.read_all,
        ),
        controllers,
    };
}

function aclEntriesFromSource(source) {
    if (!source || typeof source !== "object") return [];
    if (Array.isArray(source.users)) {
        return source.users.filter((item) => item && typeof item === "object");
    }
    if (source.users && typeof source.users === "object") {
        return Object.entries(source.users).map(([username, value]) => ({
            ...(value && typeof value === "object" ? value : {}),
            plc_username: value?.plc_username || username,
        }));
    }
    if (Array.isArray(source.acl)) {
        return source.acl.filter((item) => item && typeof item === "object");
    }
    return [];
}

function aclSourceFromSummary(summary) {
    if (!summary || typeof summary !== "object") return null;
    return (
        summary.authz ||
        summary.acl ||
        summary.system?.authz ||
        summary.system?.acl ||
        null
    );
}

function cloneSystemForAccess(system, allowNetwork) {
    if (!system || typeof system !== "object") return null;
    if (allowNetwork) return { ...system };
    const cloned = { ...system };
    delete cloned.wifi;
    delete cloned.gsm;
    return cloned;
}

function filterCollectionByIds(list, idsSet) {
    if (!Array.isArray(list)) return [];
    if (!idsSet || !(idsSet instanceof Set) || !idsSet.size) return [...list];
    return list.filter((item) => idsSet.has(Number(item?.id)));
}

function normalizePrincipal(session = {}) {
    return {
        username: lower(session.username),
        plcUsername: lower(session.plc_username),
        telegramUsername: lower(session.telegram_username),
        allowedObjects: toLowerStringSet(session.allowed_objects),
    };
}

export function resolveAccess(summary, session = {}) {
    const principal = normalizePrincipal(session);
    const cloudObjectName = lower(summary?.object_name);
    const cloudObjectAllowed =
        !principal.allowedObjects.size ||
        principal.allowedObjects.has(cloudObjectName);
    const source = aclSourceFromSummary(summary);
    if (!source) {
        return {
            restricted: false,
            matched: true,
            objectAllowed: cloudObjectAllowed,
            deviceAllowed: true,
            statusRead: true,
            networkRead: true,
            controllers: Object.fromEntries(
                CONTROLLER_KEYS.map((key) => [
                    key,
                    { read: true, write: true, ids: null, actions: null },
                ]),
            ),
        };
    }

    const rules = aclEntriesFromSource(source).map(normalizeRule);
    const rule = rules.find((item) => {
        if (!item.usernames.size) return false;
        return (
            item.usernames.has(principal.plcUsername) ||
            item.usernames.has(principal.username) ||
            item.usernames.has(principal.telegramUsername)
        );
    });

    if (!rule) {
        return {
            restricted: true,
            matched: false,
            objectAllowed: false,
            deviceAllowed: false,
            statusRead: false,
            networkRead: false,
            controllers: Object.fromEntries(
                CONTROLLER_KEYS.map((key) => [
                    key,
                    { read: false, write: false, ids: null, actions: null },
                ]),
            ),
        };
    }

    const objectName = lower(summary?.object_name);
    const deviceId = Number(summary?.device_id);
    const objectAllowed =
        cloudObjectAllowed &&
        (!rule.objects.size || rule.objects.has(objectName));
    const deviceAllowed = !rule.deviceIds.size || rule.deviceIds.has(deviceId);
    const controllers = {};
    for (const key of CONTROLLER_KEYS) {
        const policy = rule.controllers[key];
        controllers[key] =
            rule.readAll && !policy.read
                ? { ...policy, read: true }
                : rule.writeAll && !policy.write
                  ? { ...policy, read: true, write: true }
                  : policy;
    }

    return {
        restricted: true,
        matched: true,
        objectAllowed,
        deviceAllowed,
        statusRead: rule.statusRead || rule.readAll,
        networkRead: rule.networkRead || rule.readAll,
        controllers,
    };
}

export function canAccessDevice(summary, session = {}) {
    const access = resolveAccess(summary, session);
    return Boolean(access.objectAllowed && access.deviceAllowed);
}

export function sanitizeSummaryForSession(summary, session = {}) {
    if (!summary) return null;
    const access = resolveAccess(summary, session);
    if (!access.objectAllowed || !access.deviceAllowed) return null;

    const next = {
        ...summary,
        authz: undefined,
        acl: undefined,
        access: {
            status_read: access.statusRead,
            network_read: access.networkRead,
            controllers: {},
        },
    };

    if (!access.statusRead) {
        next.system = null;
    } else {
        next.system = cloneSystemForAccess(summary.system, access.networkRead);
    }

    const controllers =
        summary.controllers && typeof summary.controllers === "object"
            ? summary.controllers
            : {};
    const filteredControllers = {};
    for (const key of CONTROLLER_KEYS) {
        const policy = access.controllers[key];
        if (!policy?.read) continue;
        next.access.controllers[key] = {
            read: Boolean(policy.read),
            write: Boolean(policy.write),
            ids: policy.ids ? [...policy.ids] : null,
            actions: policy.actions ? [...policy.actions] : null,
        };
        const value = controllers[key];
        if (Array.isArray(value)) {
            filteredControllers[key] = filterCollectionByIds(value, policy.ids);
            continue;
        }
        if (value && typeof value === "object") {
            filteredControllers[key] = value;
        }
    }
    next.controllers = filteredControllers;

    if (summary.stack_units && typeof summary.stack_units === "object") {
        const nextStackUnits = {};
        for (const [nodeId, unit] of Object.entries(summary.stack_units)) {
            if (!unit || typeof unit !== "object") continue;
            const unitSummary = {
                ...summary,
                ...unit,
                name: unit.name || summary.name,
                online:
                    typeof unit.online === "boolean"
                        ? unit.online
                        : summary.online,
                system: unit.system || {},
                controllers: unit.controllers || {},
                stack_units: null,
                stack: null,
            };
            const sanitizedUnit = sanitizeSummaryForSession(
                unitSummary,
                session,
            );
            if (!sanitizedUnit) continue;
            nextStackUnits[nodeId] = {
                name: sanitizedUnit.name || unit.name || summary.name,
                online:
                    typeof sanitizedUnit.online === "boolean"
                        ? sanitizedUnit.online
                        : typeof unit.online === "boolean"
                          ? unit.online
                          : summary.online,
                system: sanitizedUnit.system || {},
                controllers: sanitizedUnit.controllers || {},
                summary:
                    sanitizedUnit.summary && typeof sanitizedUnit.summary === "object"
                        ? sanitizedUnit.summary
                        : unit.summary && typeof unit.summary === "object"
                          ? unit.summary
                          : null,
                last_event: sanitizedUnit.last_event ?? unit.last_event ?? null,
            };
        }
        next.stack_units = nextStackUnits;
    }

    return next;
}

export function canSendControllerCommand(
    summary,
    session = {},
    controller,
    action,
    args = {},
) {
    const access = resolveAccess(summary, session);
    if (!access.objectAllowed || !access.deviceAllowed) return false;
    const policy = access.controllers[String(controller || "")];
    if (!policy?.write) return false;
    if (
        policy.actions &&
        policy.actions.size &&
        !policy.actions.has(String(action || "").trim())
    )
        return false;
    if (Object.prototype.hasOwnProperty.call(args || {}, "id")) {
        const id = Number(args.id);
        if (policy.ids && policy.ids.size && !policy.ids.has(id)) return false;
    }
    return true;
}

export function filterObjectsForSummaries(objects, summaries, session = {}) {
    const principal = normalizePrincipal(session);
    const cloudRestricted = principal.allowedObjects.size > 0;
    const visibleNames = new Set();
    let sawRestrictedAcl = false;
    for (const summary of summaries) {
        const access = resolveAccess(summary, session);
        if (access.restricted) sawRestrictedAcl = true;
        if (
            access.objectAllowed &&
            access.deviceAllowed &&
            summary?.object_name
        ) {
            visibleNames.add(String(summary.object_name));
        }
    }
    if (!sawRestrictedAcl && !cloudRestricted) return objects;
    return asArray(objects).filter((item) => {
        const name = typeof item === "string" ? item : item?.name;
        if (
            cloudRestricted &&
            !principal.allowedObjects.has(lower(name))
        ) {
            return false;
        }
        if (!sawRestrictedAcl) return true;
        return visibleNames.has(String(name || ""));
    });
}
