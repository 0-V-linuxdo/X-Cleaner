/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { OWNED_ATTR } from "@x/dom";

type Placement = "top" | "bottom" | "left" | "right";
const DELAY_MS = 400;
const GAP = 8;
const MARGIN = 8;

let portal: HTMLElement | null = null;
let refs = 0;
let current: { anchor: HTMLElement; text: () => string; placement: Placement } | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let lastInputKeyboard = false;
let globalAbort: AbortController | null = null;
const PORTAL_ID = "xc-native-tooltip";

function ensurePortal(): HTMLElement {
    if (portal?.isConnected) return portal;
    portal = document.createElement("div");
    portal.id = PORTAL_ID;
    portal.className = "xc-native-tooltip";
    portal.setAttribute("role", "tooltip");
    portal.setAttribute(OWNED_ATTR, "");
    portal.hidden = true;
    document.body.appendChild(portal);
    return portal;
}

function position() {
    if (!current || !portal) return;
    const r = current.anchor.getBoundingClientRect();
    const tip = portal.getBoundingClientRect();
    const vw = innerWidth;
    const vh = innerHeight;
    const space: Record<Placement, number> = { top: r.top, bottom: vh - r.bottom, left: r.left, right: vw - r.right };
    const opposite: Record<Placement, Placement> = { top: "bottom", bottom: "top", left: "right", right: "left" };
    let p = current.placement;
    const need = p === "top" || p === "bottom" ? tip.height + GAP + MARGIN : tip.width + GAP + MARGIN;
    if (space[p] < need && space[opposite[p]] > space[p]) p = opposite[p];
    let x = 0;
    let y = 0;
    if (p === "top" || p === "bottom") {
        x = r.left + r.width / 2 - tip.width / 2;
        y = p === "top" ? r.top - GAP - tip.height : r.bottom + GAP;
    } else {
        y = r.top + r.height / 2 - tip.height / 2;
        x = p === "left" ? r.left - GAP - tip.width : r.right + GAP;
    }
    x = Math.min(Math.max(MARGIN, x), vw - tip.width - MARGIN);
    y = Math.min(Math.max(MARGIN, y), vh - tip.height - MARGIN);
    portal.style.left = `${Math.round(x)}px`;
    portal.style.top = `${Math.round(y)}px`;
    portal.dataset.placement = p;
}

function describe(anchor: HTMLElement, add: boolean) {
    const ids = (anchor.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean).filter(id => id !== PORTAL_ID);
    if (add) ids.push(PORTAL_ID);
    if (ids.length) anchor.setAttribute("aria-describedby", ids.join(" "));
    else anchor.removeAttribute("aria-describedby");
}

export function hideTooltip() {
    clearTimeout(showTimer);
    if (current) describe(current.anchor, false);
    current = null;
    if (portal) portal.hidden = true;
}

function show(anchor: HTMLElement, text: () => string, placement: Placement) {
    const value = text();
    if (!value || !anchor.isConnected) return;
    const p = ensurePortal();
    if (current && current.anchor !== anchor) describe(current.anchor, false);
    current = { anchor, text, placement };
    p.textContent = value;
    p.hidden = false;
    describe(anchor, true);
    position();
}

function ensureGlobal() {
    if (globalAbort) return;
    globalAbort = new AbortController();
    const { signal } = globalAbort;
    const opts = { signal, capture: true, passive: true };
    addEventListener("keydown", e => {
        lastInputKeyboard = true;
        if ((e as KeyboardEvent).key === "Escape") hideTooltip();
    }, opts);
    addEventListener("pointerdown", () => { lastInputKeyboard = false; hideTooltip(); }, opts);
    addEventListener("click", hideTooltip, opts);
    addEventListener("blur", hideTooltip, { signal });
    addEventListener("resize", hideTooltip, { signal });
    addEventListener("scroll", hideTooltip, opts);
}

export interface TooltipHandle {
    refresh(): void;
    destroy(): void;
}

export function attachTooltip(anchor: HTMLElement, text: string | (() => string), placement: Placement = "top"): TooltipHandle {
    const get = typeof text === "function" ? text : () => text;
    refs++;
    ensureGlobal();
    anchor.removeAttribute("title");
    const abort = new AbortController();
    const { signal } = abort;
    anchor.addEventListener("pointerenter", e => {
        if ((e as PointerEvent).pointerType === "touch") return;
        clearTimeout(showTimer);
        showTimer = setTimeout(() => show(anchor, get, placement), DELAY_MS);
    }, { signal });
    anchor.addEventListener("pointerleave", () => { if (current?.anchor === anchor || showTimer) hideTooltip(); }, { signal });
    anchor.addEventListener("focus", () => {
        let visible = lastInputKeyboard;
        try { visible ||= anchor.matches(":focus-visible"); } catch {}
        if (visible) show(anchor, get, placement);
    }, { signal });
    anchor.addEventListener("blur", () => { if (current?.anchor === anchor) hideTooltip(); }, { signal });
    let destroyed = false;
    return {
        refresh() {
            if (current?.anchor !== anchor || !portal) return;
            if (!anchor.isConnected) return hideTooltip();
            portal.textContent = get();
            position();
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            abort.abort();
            if (current?.anchor === anchor) hideTooltip();
            if (--refs <= 0) {
                refs = 0;
                portal?.remove();
                portal = null;
                globalAbort?.abort();
                globalAbort = null;
            }
        },
    };
}

export const TOOLTIP_CSS = `.xc-native-tooltip{position:fixed;z-index:2147483000;max-width:min(320px,calc(100vw - 16px));padding:3px 8px;border-radius:4px;background:rgba(91,112,131,.94);color:#fff;font:400 11px/1.4 TwitterChirp,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;pointer-events:none;white-space:pre-wrap;word-break:break-word}.xc-native-tooltip[hidden]{display:none!important}`;
