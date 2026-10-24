/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Persistent notice bar, after Void++'s Notices API: stays until closed, at most one per id.

import { t } from "@utils/i18n";
import { OWNED_ATTR } from "@x/dom";

import { h, svgIcon } from "./h";
import { Icons } from "./icons";
import { syncTheme } from "./theme";
import type { ToastType } from "./toast";

export interface NoticeOptions {
    /** A notice with the same id replaces the previous one. */
    id?: string;
    message: string;
    type?: ToastType;
    action?: { label: string; onClick(): void };
    onClose?(): void;
}

const open = new Map<string, HTMLElement>();
let stack: HTMLElement | null = null;

function container(): HTMLElement {
    if (stack?.isConnected) return stack;
    stack = h("div", { class: "xc-root xc-notices", [OWNED_ATTR]: "" });
    (document.body ?? document.documentElement).appendChild(stack);
    return stack;
}

export function showNotice(options: NoticeOptions): () => void {
    syncTheme();
    const id = options.id ?? `notice-${open.size}-${Date.now()}`;
    open.get(id)?.remove();
    const close = () => {
        if (open.get(id) !== el) return;
        open.delete(id);
        el.remove();
        if (!open.size) stack?.remove();
        options.onClose?.();
    };
    const type = options.type ?? "info";
    const el = h("div", { class: "xc-notice", role: type === "error" ? "alert" : "status", dataset: { type, id } },
        svgIcon(type === "info" || type === "success" ? Icons.info : Icons.alert, 16),
        h("span", { class: "xc-notice-message" }, options.message),
        options.action && h("button", { class: "xc-btn xc-btn-sm", type: "button", onclick: () => { options.action!.onClick(); close(); } }, options.action.label),
        h("button", { class: "xc-notice-close", type: "button", "aria-label": t("关闭"), onclick: close }, svgIcon(Icons.close, 14)),
    );
    open.set(id, el);
    container().appendChild(el);
    return close;
}

export function closeNotice(id: string) {
    const el = open.get(id);
    el?.querySelector<HTMLButtonElement>(".xc-notice-close")?.click();
}

export const hasNotice = (id: string) => open.has(id);
