/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { OWNED_ATTR } from "@x/dom";

import { h } from "./h";
import { syncTheme } from "./theme";

export type ToastType = "info" | "success" | "error" | "warning";

export interface ToastOptions {
    type?: ToastType;
    duration?: number;
    action?: { label: string; onClick(): void };
}

const DURATION = 3500;
let el: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string, options: ToastOptions = {}): () => void {
    syncTheme();
    const type = options.type ?? "info";
    el?.remove();
    clearTimeout(timer);
    const close = () => {
        if (el === toast) el = null;
        toast.remove();
    };
    const toast = h("div", { class: "xc-root xc-toast", role: type === "error" ? "alert" : "status", "aria-live": type === "error" ? "assertive" : "polite", dataset: { type }, [OWNED_ATTR]: "" },
        h("span", null, message),
        options.action && h("button", { class: "xc-btn", type: "button", onclick: () => { options.action!.onClick(); close(); } }, options.action.label),
    );
    (document.body ?? document.documentElement).appendChild(toast);
    el = toast;
    timer = setTimeout(close, options.duration ?? DURATION);
    return close;
}

export const toast = {
    info: (m: string) => showToast(m, { type: "info" }),
    success: (m: string) => showToast(m, { type: "success" }),
    error: (m: string) => showToast(m, { type: "error" }),
};
