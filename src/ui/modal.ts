/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { h, svgIcon } from "./h";
import { Icons } from "./icons";
import { syncTheme } from "./theme";

export interface ModalOptions {
    title: string;
    body: Node;
    footer?: Node[];
    wide?: boolean;
    headerExtra?: Node[];
    onClose?(): void;
}

export interface ModalHandle {
    root: HTMLElement;
    body: HTMLElement;
    close(): void;
}

export function openModal(options: ModalOptions): ModalHandle {
    syncTheme();
    const abort = new AbortController();
    const close = () => {
        if (abort.signal.aborted) return;
        abort.abort();
        overlay.remove();
        options.onClose?.();
    };
    const body = h("div", { class: "xc-modal-body" }, options.body);
    const modal = h("div", { class: `xc-modal${options.wide ? " xc-modal-wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": options.title },
        h("div", { class: "xc-modal-head" },
            h("h2", { class: "xc-modal-title" }, options.title),
            options.headerExtra ?? [],
            h("button", { class: "xc-btn xc-btn-icon", "aria-label": "Close", title: "Close", onclick: close }, svgIcon(Icons.close)),
        ),
        body,
        options.footer?.length ? h("div", { class: "xc-modal-foot" }, options.footer) : null,
    );
    const overlay = h("div", { class: "xc-root xc-overlay" }, modal);
    overlay.addEventListener("mousedown", e => { if (e.target === overlay) close(); }, { signal: abort.signal });
    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && overlay === document.querySelector(".xc-overlay:last-of-type")) { e.stopPropagation(); close(); }
    }, { signal: abort.signal, capture: true });
    for (const el of overlay.querySelectorAll(".xc-modal")) el.addEventListener("keydown", e => e.stopPropagation(), { signal: abort.signal });
    document.body.appendChild(overlay);
    return { root: modal, body, close };
}

export function confirmDialog(title: string, message: string, confirmText = "Confirm", danger = false): Promise<boolean> {
    return new Promise(resolve => {
        let result = false;
        const handle = openModal({
            title,
            body: h("p", { style: "margin:0;white-space:pre-wrap" }, message),
            footer: [
                h("button", { class: "xc-btn", onclick: () => handle.close() }, "Cancel"),
                h("button", { class: `xc-btn ${danger ? "xc-btn-danger" : "xc-btn-primary"}`, onclick: () => { result = true; handle.close(); } }, confirmText),
            ],
            onClose: () => resolve(result),
        });
    });
}
