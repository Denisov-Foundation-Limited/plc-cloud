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
  }

  connect(handlers = {}) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    this.socket = new WebSocket(`${scheme}://${location.host}/ws/web`);
    this.state.ws = this.socket;

    this.socket.addEventListener('open', () => {
      this.ui.setStatus('Онлайн');
      if (handlers.onOpen) handlers.onOpen();
    });

    this.socket.addEventListener('close', () => {
      this.ui.setStatus('Оффлайн', false);
      if (handlers.onClose) handlers.onClose();
    });

    this.socket.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (handlers.onMessage) handlers.onMessage(msg);
    });
  }

  send(payload) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  close() {
    if (this.socket) {
      this.socket.close();
    }
  }
}
