/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// 「更多」 opened in place: a click on the sidebar's 「更多」 unfolds its rows right below the button,
// as sidebar links, instead of X's popup. Rows are copies of X's sidebar links (wide or icon-only, like
// the pins), and a click replays the click on X's own menu row, opened out of sight.

import { OWNED_ATTR } from "@x/dom";

import { NAV } from "./entries";
import { buildPin, isReplaying, MORE_BUTTON, type MoreItem, showsLabels, templateLink } from "./pins";

export const INLINE_ATTR = "data-xc-inline-more";

export interface InlineRow extends MoreItem {
    /** Runs the row; X's menu rows replay their click, X Cleaner's rows run directly. */
    run(): void;
}

export interface InlineSource {
    enabled(): boolean;
    isOpen(): boolean;
    setOpen(open: boolean): void;
    /** X's 「更多」 rows, then X Cleaner's own, as groups shown with a divider between. */
    groups(): InlineRow[][];
    /** Called on every unfold so the rows stay current; may re-render through `refresh`. */
    onOpen?(): void;
}

let source: InlineSource | null = null;

const view = (): Window => document.defaultView ?? window;

const more = (nav: Element) => nav.querySelector<HTMLElement>(`:scope > ${MORE_BUTTON}`);

function render(nav: Element) {
    const button = more(nav);
    const template = button ? templateLink(nav) : null;
    const old = nav.querySelector<HTMLElement>(`:scope > [${INLINE_ATTR}]`);
    if (!source?.enabled() || !source.isOpen() || !button || !template) {
        old?.remove();
        button?.removeAttribute("data-xc-inline-open");
        return;
    }
    const wide = showsLabels(template);
    const box = document.createElement("div");
    box.setAttribute(INLINE_ATTR, String(wide));
    box.setAttribute(OWNED_ATTR, "");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", button.getAttribute("aria-label") ?? "More");
    // Stay with 「更多」 when the sidebar's own order is rearranged with CSS `order`.
    const order = getComputedStyle(button).order;
    if (order && order !== "0") box.style.order = order;
    const groups = source.groups().filter(g => g.length);
    groups.forEach((group, i) => {
        if (i) box.appendChild(Object.assign(document.createElement("div"), { className: "xc-inline-sep" }));
        for (const row of group) box.appendChild(buildPin(template, row, () => row.run()));
    });
    if (old) old.replaceWith(box);
    else button.after(box);
    button.setAttribute("data-xc-inline-open", "");
}

/** Keeps the unfolded rows in step with X's sidebar: present when open, rebuilt when wide ↔ icon-only. */
export function syncInline(nav: Element) {
    const box = nav.querySelector<HTMLElement>(`:scope > [${INLINE_ATTR}]`);
    const want = !!source?.enabled() && source.isOpen();
    if (!want) {
        if (box) render(nav);
        return;
    }
    const template = templateLink(nav);
    const button = more(nav);
    if (!box || !template || box.previousElementSibling !== button || box.getAttribute(INLINE_ATTR) !== String(showsLabels(template))) render(nav);
}

export function refreshInline() {
    const nav = document.querySelector(NAV);
    if (nav) render(nav);
}

function onClick(e: MouseEvent) {
    if (!source?.enabled() || isReplaying()) return;
    const button = (e.target as Element | null)?.closest?.(MORE_BUTTON);
    if (!button || !button.closest(NAV)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const open = !source.isOpen();
    source.setOpen(open);
    refreshInline();
    // After this click has finished: opening X's menu out of sight dispatches a click of its own.
    if (open) setTimeout(() => source?.onOpen?.(), 0);
}

/** Takes over clicks on 「更多」. Listens on window so it runs before X's and other plugins' handlers. */
export function startInline(src: InlineSource) {
    source = src;
    view().addEventListener("click", onClick, true);
    refreshInline();
}

export function stopInline() {
    view().removeEventListener("click", onClick, true);
    source = null;
    for (const box of document.querySelectorAll(`[${INLINE_ATTR}]`)) box.remove();
    for (const b of document.querySelectorAll("[data-xc-inline-open]")) b.removeAttribute("data-xc-inline-open");
}
