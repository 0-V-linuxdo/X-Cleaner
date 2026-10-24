/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Void++'s ContextMenu API for X: plugins declare `postMenuItems` / `profileMenuItems` and they show up
// at the end of the 「…」 menu X opens from a post or a profile. Items are cloned from X's own menu rows
// so they look native.

import { defineHook } from "@api/PluginManager";
import { svgIcon } from "@ui/h";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { findIdentityLink, isInNestedStatusCard, OWNED_ATTR, profilePathHandle, SEL } from "@x/dom";

const logger = new Logger("PostMenu");

export interface PostMenuContext {
    article: HTMLElement;
    tweetId: string;
    handle: string;
    statusUrl: string;
}

export interface ProfileMenuContext {
    handle: string;
    profileUrl: string;
}

export interface MenuItem<C> {
    id: string;
    label(ctx: C): string;
    /** SVG markup, as in Icons. */
    icon?: string;
    order?: number;
    danger?: boolean;
    visible?(ctx: C): boolean;
    run(ctx: C): void | Promise<void>;
}

export type PostMenuItem = MenuItem<PostMenuContext>;
export type ProfileMenuItem = MenuItem<ProfileMenuContext>;

declare module "@utils/types" {
    interface PluginHooks {
        postMenuItems?: PostMenuItem[];
        profileMenuItems?: ProfileMenuItem[];
    }
}

export const MENU_SEL = '#layers [role="menu"]';
export const ITEM_ATTR = "data-xc-post-menu-item";
const WAIT_MS = 1500;
const STRIP = ["id", "data-testid", "href", "aria-describedby", "aria-labelledby", "aria-controls", "aria-haspopup", "aria-expanded"];

const registry = new Map<string, PostMenuItem[]>();
const profileRegistry = new Map<string, ProfileMenuItem[]>();

const sorted = <T extends { order?: number }>(m: Map<string, T[]>): T[] => [...m.values()].flat().toSorted((a, b) => (a.order ?? 100) - (b.order ?? 100));
export const registeredItems = (): PostMenuItem[] => sorted(registry);
export const registeredProfileItems = (): ProfileMenuItem[] => sorted(profileRegistry);

/** The profile whose header 「…」 button was pressed; only on a /<handle> page, never on your own. */
export function contextForProfileButton(button: Element): ProfileMenuContext | null {
    if (!button.closest(SEL.primaryColumn)) return null;
    const handle = profilePathHandle(location.pathname);
    if (!handle) return null;
    return { handle, profileUrl: new URL(`/${handle}`, location.origin).href };
}

/** The post whose own caret was pressed; null for carets that aren't a post's (trends, quoted cards). */
export function contextForCaret(caret: Element): PostMenuContext | null {
    const article = caret.closest<HTMLElement>(SEL.tweet);
    if (!article) return null;
    const id = findIdentityLink(article);
    if (!id || isInNestedStatusCard(caret, article, id.tweetId)) return null;
    return { article, tweetId: id.tweetId, handle: id.handle, statusUrl: new URL(`/${id.handle}/status/${id.tweetId}`, location.origin).href };
}

/** Closes an X menu the way a user does: by clicking the backdrop that sits next to it. */
export function closeMenu(menu: Element) {
    const backdrop = [...menu.parentElement?.children ?? []].find(s => s !== menu && s instanceof HTMLElement && !s.hasAttribute(OWNED_ATTR) && s.getBoundingClientRect().height > 100) as HTMLElement | undefined;
    if (backdrop) backdrop.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
}

/** Copies one of X's menu rows and puts our icon and label into it. */
export function cloneMenuRow(template: HTMLElement, label: string, icon?: string): HTMLElement {
    const row = template.cloneNode(true) as HTMLElement;
    for (const el of [row, ...row.querySelectorAll<HTMLElement>("*")]) for (const a of STRIP) el.removeAttribute(a);
    row.setAttribute("role", "menuitem");
    row.setAttribute("tabindex", "0");
    row.setAttribute(OWNED_ATTR, "");
    const nativeSvg = row.querySelector("svg");
    if (nativeSvg) {
        if (icon) {
            const ours = svgIcon(icon, 18).querySelector("svg");
            if (ours) {
                const cls = nativeSvg.getAttribute("class");
                if (cls) ours.setAttribute("class", cls);
                ours.removeAttribute("width");
                ours.removeAttribute("height");
                ours.setAttribute("aria-hidden", "true");
                ours.style.fill = "none";
                nativeSvg.replaceWith(ours);
            }
        } else nativeSvg.remove();
    }
    const spans = [...row.querySelectorAll("span")].filter(s => !s.childElementCount);
    const textHost = spans.at(-1) ?? row.querySelector("[dir]") ?? row;
    textHost.textContent = label;
    for (const s of spans.slice(0, -1)) s.remove();
    return row;
}

function template(menu: Element): HTMLElement | null {
    const rows = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(r => !r.hasAttribute(OWNED_ATTR));
    return rows.find(r => r.tagName !== "A" && !r.querySelector("a")) ?? rows[0] ?? null;
}

export function fillMenu(menu: Element, ctx: PostMenuContext): HTMLElement[] {
    return fillMenuWith(menu, registeredItems(), ctx);
}

export function fillProfileMenu(menu: Element, ctx: ProfileMenuContext): HTMLElement[] {
    return fillMenuWith(menu, registeredProfileItems(), ctx);
}

function fillMenuWith<C>(menu: Element, items: MenuItem<C>[], ctx: C): HTMLElement[] {
    if (menu.querySelector(`[${ITEM_ATTR}]`)) return [];
    const tpl = template(menu);
    const host = tpl?.parentElement;
    if (!tpl || !host) return [];
    const added: HTMLElement[] = [];
    for (const item of items) {
        let label: string;
        try {
            if (item.visible && !item.visible(ctx)) continue;
            label = item.label(ctx);
        } catch (e) {
            logger.error(`Menu item ${item.id} failed`, e);
            continue;
        }
        const row = cloneMenuRow(tpl, label, item.icon);
        row.setAttribute(ITEM_ATTR, item.id);
        if (item.danger) row.style.color = "rgb(244, 33, 46)";
        const activate = (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            closeMenu(menu);
            Promise.resolve().then(() => item.run(ctx)).catch(err => logger.error(`Menu item ${item.id} failed`, err));
        };
        row.addEventListener("click", activate);
        row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") activate(e); });
        host.appendChild(row);
        added.push(row);
    }
    if (added.length) keepAtEnd(menu, added);
    return added;
}

/**
 * The profile menu first renders its rows straight inside the menu and then moves them into a
 * wrapper, which would leave ours on top. Follow X's rows for a moment and stay after them.
 */
function keepAtEnd(menu: Element, rows: HTMLElement[]) {
    const place = () => {
        const host = template(menu)?.parentElement;
        if (!host || rows.every(r => r.parentElement === host) && host.lastElementChild === rows.at(-1)) return;
        observer.disconnect();
        host.append(...rows);
        observer.observe(menu, { childList: true, subtree: true });
    };
    const observer = new MutationObserver(place);
    observer.observe(menu, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), WAIT_MS);
}

let pending: { fill(menu: Element): void; at: number } | null = null;
let observer: MutationObserver | null = null;

function tryFill() {
    if (!pending) return;
    if (Date.now() - pending.at > WAIT_MS) { pending = null; return; }
    const menu = document.querySelector(MENU_SEL);
    if (!menu || !template(menu)) return;
    const { fill } = pending;
    pending = null;
    fill(menu);
}

function onClick(e: MouseEvent) {
    const target = e.target as Element | null;
    const caret = registry.size ? target?.closest?.(SEL.caret) : null;
    const ctx = caret && contextForCaret(caret);
    if (ctx) pending = { fill: menu => fillMenu(menu, ctx), at: Date.now() };
    const profileButton = profileRegistry.size ? target?.closest?.(SEL.userActions) : null;
    const profile = profileButton && contextForProfileButton(profileButton);
    if (profile) pending = { fill: menu => fillProfileMenu(menu, profile), at: Date.now() };
    if (pending) queueMicrotask(tryFill);
}

export default definePlugin({
    name: "PostMenuAPI",
    description: "Lets plugins add items to the 「…」 menu of a post or a profile.",
    tags: ["core"],
    hidden: true,

    start() {
        document.addEventListener("click", onClick, true);
        observer = new MutationObserver(() => { if (pending) tryFill(); });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    },

    stop() {
        document.removeEventListener("click", onClick, true);
        observer?.disconnect();
        observer = null;
        pending = null;
        for (const el of document.querySelectorAll(`[${ITEM_ATTR}]`)) el.remove();
    },
});

defineHook("postMenuItems", {
    provider: "PostMenuAPI",
    attach(plugin, items) {
        registry.set(plugin.name, items);
        return () => registry.delete(plugin.name);
    },
});

defineHook("profileMenuItems", {
    provider: "PostMenuAPI",
    attach(plugin, items) {
        profileRegistry.set(plugin.name, items);
        return () => profileRegistry.delete(plugin.name);
    },
});
