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
export class WebSocketClient {
    constructor({ state, ui }) {
        this.state = state;
        this.ui = ui;
        this.socket = null;
        this.pending = [];
        this.handlers = {};
        this.reconnectTimer = null;
        this.manualClose = false;
    }

    connect(handlers = {}) {
        this.handlers = handlers;
        this.manualClose = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
        if (this.socket && this.socket.readyState === WebSocket.CONNECTING)
            return;
        const scheme = location.protocol === "https:" ? "wss" : "ws";
        this.socket = new WebSocket(`${scheme}://${location.host}/ws/web`);
        this.state.ws = this.socket;

        this.socket.addEventListener("open", () => {
            this.ui.setStatus("Онлайн");
            const queued = this.pending.splice(0, this.pending.length);
            for (const payload of queued) {
                this.socket.send(payload);
            }
            if (this.handlers.onOpen) this.handlers.onOpen();
        });

        this.socket.addEventListener("close", () => {
            this.ui.setStatus("Оффлайн", false);
            if (this.handlers.onClose) this.handlers.onClose();
            this.socket = null;
            this.state.ws = null;
            if (!this.manualClose && !this.reconnectTimer) {
                this.reconnectTimer = setTimeout(() => {
                    this.reconnectTimer = null;
                    this.connect(this.handlers);
                }, 1500);
            }
        });

        this.socket.addEventListener("message", (event) => {
            const msg = JSON.parse(event.data);
            if (this.handlers.onMessage) this.handlers.onMessage(msg);
        });
    }

    send(payload) {
        const encoded = JSON.stringify(payload);
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(encoded);
            return true;
        }
        if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
            this.pending.push(encoded);
            return true;
        }
        return false;
    }

    close() {
        this.manualClose = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.socket) {
            this.socket.close();
        }
        this.pending = [];
    }
}
