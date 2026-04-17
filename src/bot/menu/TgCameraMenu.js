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
import { InlineKeyboard, InputFile } from "grammy";
import { canSendControllerCommand } from "../../auth/AccessControl.js";
import fs from "node:fs";
import path from "node:path";

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function panelTitle(title, subtitle = "") {
    return [
        `<b>${escapeHtml(title)}</b>`,
        subtitle ? `<code>${escapeHtml(subtitle)}</code>` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

function compactLabel(value, max = 28) {
    const raw = String(value || "").trim();
    if (!raw) return "-";
    return raw.length > max ? `${raw.slice(0, max)}…` : raw;
}

function statusLine(camera) {
    if (!camera?.enabled) return "⚪ отключена";
    if (camera?.busy) return "🟠 получаем фото";
    if (String(camera?.last_error || "").trim()) {
        return `🔴 ${String(camera.last_error).trim()}`;
    }
    if (String(camera?.latest_url || "").trim()) return "🟢 снимок готов";
    return "⚪ снимка пока нет";
}

export class TgCameraMenu {
    constructor({ registry, devicesDb }) {
        this.registry = registry;
        this.devicesDb = devicesDb;
        this.deviceWs = null;
    }

    setDeviceWs(deviceWs) {
        this.deviceWs = deviceWs;
    }

    controllerCallbackData(deviceId, nodeId = 0) {
        return `menu:controller:${Number(deviceId)}:${Number(nodeId || 0)}:cameras`;
    }

    snapshotCallbackData(deviceId, nodeId = 0, cameraId) {
        return `menu:camera:snapshot:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(cameraId)}`;
    }

    async open(
        ctx,
        {
            deviceId,
            nodeId = null,
            user,
            getScopedDetail,
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        },
    ) {
        const detail = await getScopedDetail(deviceId, nodeId, user);
        if (!detail) {
            await replyMenu(
                ctx,
                "Устройство недоступно.",
                this.buildBackKeyboard(
                    Number(deviceId),
                    Number(nodeId || 0),
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }

        await this.replyCameraMenu_(ctx, detail, {
            deviceId,
            nodeId,
            replyMenu,
            controllersCallbackData,
            mainMenuCallbackData,
        });
    }

    async snapshot(
        ctx,
        {
            deviceId,
            nodeId = null,
            cameraId,
            user,
            getScopedDetail,
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        },
    ) {
        const detail = await getScopedDetail(deviceId, nodeId, user);
        if (!detail) {
            await this.answerCallback_(ctx, {
                text: "Устройство недоступно",
                show_alert: true,
            });
            return;
        }
        const camera = this.findCamera(detail, cameraId);
        if (!camera || !camera.enabled) {
            await this.answerCallback_(ctx, {
                text: "Камера не найдена",
                show_alert: true,
            });
            return;
        }

        const summary = await this.registry.buildSummary(
            Number(deviceId),
            this.devicesDb,
        );
        if (
            !canSendControllerCommand(
                summary,
                user || {},
                "cameras",
                "snapshot",
                { id: Number(cameraId) },
            )
        ) {
            await this.answerCallback_(ctx, {
                text: "Нет прав на снимок",
                show_alert: true,
            });
            return;
        }

        let pendingDetail = this.markCameraBusy_(detail, cameraId);
        if (camera?.busy) {
            await this.answerCallback_(ctx, {
                text: `📷 ${camera.name || `Камера #${cameraId}`}: уже получаем снимок`,
            });
            this.deviceWs?.sendGet(Number(deviceId), ["controllers"], "local");
        } else {
            const result = this.deviceWs?.sendCmd(
                Number(deviceId),
                "cameras",
                "snapshot",
                { id: Number(cameraId) },
                {
                    uid: user?.username || user?.plc_username || "",
                    username: user?.username || "",
                    plc_username: user?.plc_username || "",
                    source: "telegram",
                    session_id: `tg:${String(user?.chat_id || "")}`,
                },
                "local",
                undefined,
            );
            if (!result?.ok) {
                await this.answerCallback_(ctx, {
                    text: "Команда не отправлена",
                    show_alert: true,
                });
                return;
            }

            this.deviceWs?.sendGet(Number(deviceId), ["controllers"], "local");
            await this.answerCallback_(ctx, {
                text: `📷 ${camera.name || `Камера #${cameraId}`}`,
            });
        }

        await this.replyCameraMenu_(ctx, pendingDetail, {
            deviceId,
            nodeId,
            replyMenu,
            controllersCallbackData,
            mainMenuCallbackData,
        });

        const snapshot = await this.waitForSnapshot_({
            deviceId,
            cameraId: Number(cameraId),
            user,
            getScopedDetail,
        });
        const fallbackLatestUrl = this.buildLatestRelativeUrl_(
            Number(deviceId),
            Number(cameraId),
        );
        const fallbackLatestFsPath = this.buildLatestFsPath_(
            Number(deviceId),
            Number(cameraId),
        );
        if (!snapshot.ok && snapshot.error_code === "camera_error") {
            await replyMenu(
                ctx,
                [
                    panelTitle(`📷 ${detail.name || `#${deviceId}`}`, camera.name || `Камера #${cameraId}`),
                    escapeHtml(snapshot.error || "Не удалось получить снимок."),
                ].join("\n\n"),
                this.buildKeyboard(
                    detail,
                    this.enabledCameras(detail),
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }

        if (!snapshot.ok) {
            try {
                await fs.promises.access(fallbackLatestFsPath, fs.constants.R_OK);
                snapshot.ok = true;
                snapshot.latestUrl = fallbackLatestUrl;
                snapshot.latestFsPath = fallbackLatestFsPath;
                snapshot.detail = detail;
            } catch {}
        }

        if (!snapshot.ok) {
            await replyMenu(
                ctx,
                [
                    panelTitle(`📷 ${detail.name || `#${deviceId}`}`, camera.name || `Камера #${cameraId}`),
                    escapeHtml(snapshot.error || "Не удалось получить снимок."),
                ].join("\n\n"),
                this.buildKeyboard(
                    detail,
                    this.enabledCameras(detail),
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }

        const latestPath = String(snapshot.latestUrl || fallbackLatestUrl || "").trim();
        const latestFsPath = String(snapshot.latestFsPath || fallbackLatestFsPath || "").trim();

        const caption = [
            `📷 <b>${escapeHtml(camera.name || `Камера #${cameraId}`)}</b>`,
            `<b>${escapeHtml(snapshot.detail?.name || detail.name || `#${deviceId}`)}</b>`,
        ].join("\n");

        await this.sendPhotoWithRetry_(ctx, latestFsPath, {
            caption,
            parse_mode: "HTML",
        });
    }

    enabledCameras(detail) {
        const list = Array.isArray(detail?.controllers?.cameras)
            ? detail.controllers.cameras
            : [];
        return list.filter((camera) => Boolean(camera?.enabled));
    }

    findCamera(detail, cameraId) {
        return this.enabledCameras(detail).find(
            (camera) => Number(camera?.id || 0) === Number(cameraId),
        );
    }

    buildKeyboard(detail, cameras, controllersCallbackData, mainMenuCallbackData) {
        const keyboard = new InlineKeyboard();
        cameras.forEach((camera, index) => {
            const id = Number(camera?.id || 0);
            const label = `📷 ${compactLabel(camera?.name || `Камера #${id || index + 1}`, 18)}`;
            keyboard.text(
                label,
                this.snapshotCallbackData(
                    Number(detail?.device_id),
                    Number(detail?.node_id || 0),
                    id,
                ),
            );
            if (index % 2 === 1 || index === cameras.length - 1) {
                keyboard.row();
            }
        });
        keyboard
            .text(
                "🧩 Контроллеры",
                controllersCallbackData(
                    Number(detail?.device_id),
                    Number(detail?.node_id || 0),
                ),
            );
        return keyboard;
    }

    buildBackKeyboard(deviceId, nodeId, controllersCallbackData, mainMenuCallbackData) {
        return new InlineKeyboard().text(
            "🧩 Контроллеры",
            controllersCallbackData(deviceId, nodeId || 0),
        );
    }

    async replyCameraMenu_(
        ctx,
        detail,
        {
            deviceId,
            nodeId,
            replyMenu,
            controllersCallbackData,
            mainMenuCallbackData,
        },
    ) {
        const cameras = this.enabledCameras(detail);
        if (!cameras.length) {
            await replyMenu(
                ctx,
                "Нет включенных камер.",
                this.buildBackKeyboard(
                    deviceId,
                    nodeId,
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }
        const rows = cameras.map((camera, index) => {
            const id = Number(camera?.id || 0);
            const name = String(
                camera?.name || `Камера #${id || index + 1}`,
            ).trim();
            return [
                `${index + 1}. 📷 ${compactLabel(name)}`,
                `   ${statusLine(camera)}`,
            ].join("\n");
        });
        await replyMenu(
            ctx,
            [
                panelTitle(`📷 ${detail.name || `#${deviceId}`}`, "Камеры"),
                rows.map(escapeHtml).join("\n\n"),
            ].join("\n\n"),
            this.buildKeyboard(
                detail,
                cameras,
                controllersCallbackData,
                mainMenuCallbackData,
            ),
        );
    }

    markCameraBusy_(detail, cameraId) {
        const next = {
            ...detail,
            controllers: {
                ...(detail?.controllers || {}),
                cameras: Array.isArray(detail?.controllers?.cameras)
                    ? detail.controllers.cameras.map((camera) => {
                          if (
                              Number(camera?.id || 0) !== Number(cameraId)
                          ) {
                              return camera;
                          }
                          return {
                              ...camera,
                              busy: true,
                              last_error: "",
                          };
                      })
                    : [],
            },
        };
        return next;
    }

    async waitForSnapshot_({ deviceId, cameraId, user, getScopedDetail }) {
        const startedAt = Date.now();
        const timeoutMs = 15000;
        const latestFsPath = this.buildLatestFsPath_(deviceId, cameraId);
        let lastDetailPollMs = 0;
        while (Date.now() - startedAt < timeoutMs) {
            await this.delay(200);
            try {
                const stat = await fs.promises.stat(latestFsPath);
                if (
                    stat &&
                    Number.isFinite(Number(stat.mtimeMs)) &&
                    Number(stat.mtimeMs) >= startedAt
                ) {
                    const detail = await getScopedDetail(deviceId, null, user);
                    return {
                        ok: true,
                        latestUrl: this.buildLatestRelativeUrl_(deviceId, cameraId),
                        latestFsPath,
                        detail,
                    };
                }
            } catch {}

            if (Date.now() - lastDetailPollMs < 1000) {
                continue;
            }
            lastDetailPollMs = Date.now();

            const detail = await getScopedDetail(deviceId, null, user);
            if (!detail) continue;
            const camera = this.findCamera(detail, cameraId);
            if (!camera) {
                return {
                    ok: false,
                    error: "Камера исчезла из списка.",
                    error_code: "camera_missing",
                    detail,
                };
            }
            if (camera.busy) continue;
            const lastError = String(camera?.last_error || "").trim();
            if (lastError) {
                return {
                    ok: false,
                    error: lastError,
                    error_code: "camera_error",
                    detail,
                };
            }
            const latestUrl = String(camera?.latest_url || "").trim();
            if (latestUrl) {
                return {
                    ok: true,
                    latestUrl,
                    latestFsPath,
                    detail,
                };
            }
        }
        return {
            ok: false,
            error: "Таймаут ожидания снимка.",
            error_code: "timeout",
        };
    }

    buildLatestRelativeUrl_(deviceId, cameraId) {
        return `/uploads/devices/${Number(deviceId)}/camera_${Number(cameraId)}/latest.jpg`;
    }

    buildLatestFsPath_(deviceId, cameraId) {
        return path.resolve(
            process.cwd(),
            "public",
            "uploads",
            "devices",
            String(Number(deviceId)),
            `camera_${Number(cameraId)}`,
            "latest.jpg",
        );
    }

    async answerCallback_(ctx, options = {}) {
        if (
            typeof ctx?.answerCallbackQuery === "function" &&
            String(ctx?.callbackQuery?.id || "").trim()
        ) {
            try {
                await ctx.answerCallbackQuery(options);
            } catch {}
        }
    }

    async sendPhotoWithRetry_(ctx, filePath, options = {}) {
        const chatId = ctx?.chat?.id || ctx?.callbackQuery?.message?.chat?.id;
        if (!chatId) {
            throw new Error("telegram_chat_missing");
        }
        let lastError = null;
        for (let attempt = 0; attempt < 4; attempt += 1) {
            try {
                await fs.promises.access(filePath, fs.constants.R_OK);
                const stream = fs.createReadStream(filePath);
                await ctx.api.sendPhoto(
                    chatId,
                    new InputFile(stream, path.basename(filePath) || "camera.jpg"),
                    options,
                );
                return;
            } catch (err) {
                lastError = err;
                await this.delay(1200);
            }
        }
        throw lastError || new Error("telegram_photo_send_failed");
    }

    delay(ms) {
        return new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, Number(ms) || 0)),
        );
    }
}
