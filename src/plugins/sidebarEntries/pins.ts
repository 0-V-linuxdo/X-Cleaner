/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Rows of X's 「更多」 menu pinned into the sidebar, right above the 「更多」 button. Each pin is a copy of
// one of X's own sidebar links, rebuilt whenever X re-renders the sidebar (wide ↔ icon-only), and a click
// on it replays a click on the matching menu row so X does exactly what its menu would do.

import { registerStyle, unregisterStyle } from "@utils/css";
import { OWNED_ATTR } from "@x/dom";

import { NAV, PIN_ATTR } from "./entries";

export const MORE_BUTTON = '[data-testid="AppTabBar_More_Menu"]';
export const MENU_SEL = '#layers [role="menu"]';
/** Marks X's 「更多」 menu rows the user hid; the plugin's stylesheet hides them. */
export const MENU_HIDDEN_ATTR = "data-xc-menu-hidden";
const HIDE_STYLE = "sidebarEntries:menuReplay";
const WAIT_MS = 1500;
const STRIP = ["id", "data-testid", "aria-current", "aria-describedby", "aria-labelledby", "aria-controls", "aria-haspopup", "aria-expanded", "aria-selected"];
/** Plain sidebar links whose look a pin copies; notification and message links carry badges. */
const TEMPLATES = ["AppTabBar_Explore_Link", "AppTabBar_Profile_Link", "AppTabBar_Home_Link"];

export interface MoreItem {
    key: string;
    label: string;
    href?: string;
    /** The row's SVG, copied from X's menu. */
    icon?: string;
}

const quote = (v: string) => JSON.stringify(v);
const isExternal = (href: string) => /^https?:\/\//i.test(href) && !href.startsWith(location.origin);

/** A menu row's identity: its link path (per-user paths use `~`), its data-testid, else its text. */
export function moreItemKey(href: string | null, tid: string | null, label: string): string {
    if (href) {
        if (isExternal(href)) {
            try {
                const u = new URL(href);
                return `url:${u.host}${u.pathname.replace(/\/$/, "")}`;
            } catch { /* fall through */ }
        } else {
            const path = new URL(href, location.origin).pathname;
            const own = path.match(/^\/[^/]+\/(lists|communities|articles|creator-studio)$/);
            return own && !path.startsWith("/i/") ? `href:/~/${own[1]}` : `href:${path}`;
        }
    }
    if (tid) return `tid:${tid}`;
    return `text:${label}`;
}

const firstLine = (el: Element) => ((el as HTMLElement).innerText || el.textContent || "").trim().split("\n")[0].trim();

/** X's own rows in an open 「更多」 menu, outermost clickable element first. */
export function menuRows(menu: Element): HTMLElement[] {
    const all = [...menu.querySelectorAll<HTMLElement>('a[href], [role="menuitem"]')]
        .filter(el => !el.closest(`[${OWNED_ATTR}]`) && !el.closest("[data-xc-more-entry]"));
    return all.filter(el => !all.some(other => other !== el && other.contains(el)));
}

export function describeMoreRow(row: Element): MoreItem | null {
    const label = firstLine(row);
    if (!label) return null;
    const link = row.matches("a[href]") ? row : row.querySelector("a[href]");
    const href = link?.getAttribute("href") ?? undefined;
    const tid = row.getAttribute("data-testid") ?? link?.getAttribute("data-testid") ?? null;
    const svg = row.querySelector("svg");
    let icon: string | undefined;
    if (svg) {
        const copy = svg.cloneNode(true) as SVGElement;
        for (const a of ["class", "style", "width", "height", "id"]) copy.removeAttribute(a);
        icon = copy.outerHTML.length < 8000 ? copy.outerHTML : undefined;
    }
    return { key: moreItemKey(href ?? null, tid, label), label, href, icon };
}

export function readMoreMenu(menu: Element): MoreItem[] {
    const seen = new Set<string>();
    const out: MoreItem[] = [];
    for (const row of menuRows(menu)) {
        const item = describeMoreRow(row);
        if (!item || seen.has(item.key)) continue;
        seen.add(item.key);
        out.push(item);
    }
    return out;
}

/** Hides the rows whose key is in `hidden` and shows the rest; hidden rows stay clickable for pins. */
export function markHiddenRows(menu: Element, hidden: ReadonlySet<string>) {
    for (const row of menuRows(menu)) {
        const key = describeMoreRow(row)?.key;
        const hide = !!key && hidden.has(key);
        if (hide !== row.hasAttribute(MENU_HIDDEN_ATTR)) row.toggleAttribute(MENU_HIDDEN_ATTR, hide);
    }
}

/** The 「更多」 menu is the one that holds X's settings link, or the one the 「更多」 button says it opened. */
export function isMoreMenu(menu: Element): boolean {
    return !!menu.querySelector('a[href="/settings"]') || document.querySelector(MORE_BUTTON)?.getAttribute("aria-expanded") === "true";
}

/** A sidebar link to copy: not the current page's (X draws that one bold), and without a badge. */
function templateLink(nav: Element): HTMLElement | null {
    const links = [...nav.querySelectorAll<HTMLElement>(":scope > a[href]")].filter(a => !a.hasAttribute(PIN_ATTR));
    const here = location.pathname;
    const idle = (a: HTMLElement) => {
        const path = a.getAttribute("href")!.split(/[?#]/)[0];
        return path !== here && !(path.length > 1 && here.startsWith(`${path}/`)) && a.getAttribute("aria-current") !== "page";
    };
    for (const tid of TEMPLATES) {
        const a = links.find(l => l.getAttribute("data-testid") === tid);
        if (a && idle(a)) return a;
    }
    return links.find(idle) ?? links[0] ?? null;
}

/** Whether X currently shows text in its sidebar (wide) or icons only (collapsed). */
const showsLabels = (link: Element) => [...link.querySelectorAll("span")].some(s => !s.childElementCount && s.textContent?.trim());

function iconFrom(markup: string, like: SVGElement | null): SVGElement | null {
    const withNs = /<svg[^>]*\sxmlns=/.test(markup) ? markup : markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    const doc = new DOMParser().parseFromString(withNs, "image/svg+xml");
    if (doc.documentElement.nodeName.toLowerCase() !== "svg") return null;
    const svg = document.importNode(doc.documentElement, true) as unknown as SVGElement;
    for (const s of svg.querySelectorAll("script, foreignObject")) s.remove();
    for (const el of [svg, ...svg.querySelectorAll("*")]) for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
    const cls = like?.getAttribute("class");
    if (cls) svg.setAttribute("class", cls);
    svg.setAttribute("aria-hidden", "true");
    return svg;
}

export function buildPin(template: HTMLElement, item: MoreItem, onActivate: (item: MoreItem, e: Event) => void): HTMLElement {
    const pin = template.cloneNode(true) as HTMLElement;
    for (const el of [pin, ...pin.querySelectorAll<HTMLElement>("*")]) for (const a of STRIP) el.removeAttribute(a);
    pin.setAttribute(PIN_ATTR, item.key);
    pin.setAttribute(OWNED_ATTR, "");
    pin.setAttribute("aria-label", item.label);
    pin.setAttribute("title", item.label);
    if (item.href) {
        pin.setAttribute("href", item.href);
        pin.setAttribute("role", "link");
        if (isExternal(item.href)) {
            pin.setAttribute("target", "_blank");
            pin.setAttribute("rel", "noopener noreferrer");
        }
    } else {
        pin.removeAttribute("href");
        pin.setAttribute("role", "button");
        pin.setAttribute("tabindex", "0");
        pin.style.cursor = "pointer";
    }
    // Only the first icon is the entry's own; later ones are badges or extras.
    const svgs = [...pin.querySelectorAll("svg")];
    const native = svgs[0] ?? null;
    for (const extra of svgs.slice(1)) extra.remove();
    const icon = item.icon ? iconFrom(item.icon, native) : null;
    if (native && icon) native.replaceWith(icon);
    for (const badge of pin.querySelectorAll('[aria-live], [data-testid*="badge" i]')) badge.remove();
    const spans = [...pin.querySelectorAll("span")].filter(s => !s.childElementCount && s.textContent?.trim());
    if (spans.length) {
        spans.at(-1)!.textContent = item.label;
        for (const s of spans.slice(0, -1)) s.remove();
    }
    pin.addEventListener("click", e => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (item.href && isExternal(item.href)) return;
        e.preventDefault();
        e.stopPropagation();
        onActivate(item, e);
    });
    pin.addEventListener("keydown", e => {
        if (!item.href && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onActivate(item, e);
        }
    });
    return pin;
}

/**
 * Brings the sidebar's pins in line with `items`: right above 「更多」, in order, and matching X's current
 * wide or icon-only look. Leaves the DOM alone when it already matches, so it can run on every mutation.
 */
export function syncPins(nav: Element, items: MoreItem[], onActivate: (item: MoreItem, e: Event) => void): boolean {
    const existing = [...nav.querySelectorAll<HTMLElement>(`:scope > [${PIN_ATTR}]`)];
    const more = nav.querySelector<HTMLElement>(`:scope > ${MORE_BUTTON}`);
    const template = more && items.length ? templateLink(nav) : null;
    if (!more || !template) {
        if (!existing.length) return false;
        for (const p of existing) p.remove();
        return true;
    }
    const wide = showsLabels(template);
    const inPlace = existing.length === items.length
        && existing.every((p, i) => p.getAttribute(PIN_ATTR) === items[i].key && p.dataset.xcWide === String(wide))
        && existing.every((p, i) => p.nextElementSibling === (existing[i + 1] ?? more));
    if (inPlace) return false;
    for (const p of existing) p.remove();
    for (const item of items) {
        const pin = buildPin(template, item, onActivate);
        pin.dataset.xcWide = String(wide);
        nav.insertBefore(pin, more);
    }
    return true;
}

function waitFor<T>(find: () => T | null, ms = WAIT_MS): Promise<T | null> {
    return new Promise(resolve => {
        const found = find();
        if (found) return resolve(found);
        const start = Date.now();
        const observer = new MutationObserver(() => {
            const hit = find();
            if (hit || Date.now() - start > ms) {
                observer.disconnect();
                clearTimeout(timer);
                resolve(hit);
            }
        });
        const timer = setTimeout(() => { observer.disconnect(); resolve(find()); }, ms);
        observer.observe(document.documentElement, { childList: true, subtree: true });
    });
}

const closeMenu = (menu: Element) => {
    const backdrop = [...menu.parentElement?.children ?? []].find(s => s !== menu && s instanceof HTMLElement && s.getBoundingClientRect().height > 100) as HTMLElement | undefined;
    if (backdrop) backdrop.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
};

/**
 * Opens X's 「更多」 menu out of sight and hands it to `use`, which may click a row (X then closes the
 * menu) or return false to have it closed here.
 */
export async function withHiddenMoreMenu(use: (menu: Element) => boolean | void): Promise<boolean> {
    const button = document.querySelector<HTMLElement>(`${NAV} ${MORE_BUTTON}`) ?? document.querySelector<HTMLElement>(MORE_BUTTON);
    if (!button) return false;
    registerStyle(HIDE_STYLE, `${MENU_SEL}{opacity:0 !important}`);
    try {
        if (!document.querySelector(MENU_SEL)) button.click();
        const menu = await waitFor(() => {
            const m = document.querySelector(MENU_SEL);
            return m && menuRows(m).length ? m : null;
        });
        if (!menu) return false;
        const done = use(menu) !== false;
        if (!done && menu.isConnected) closeMenu(menu);
        return done;
    } finally {
        setTimeout(() => unregisterStyle(HIDE_STYLE), 150);
    }
}

/** Replays a click on the 「更多」 row behind a pin; falls back to the link itself when the row is gone. */
export async function activatePin(item: MoreItem): Promise<void> {
    const clicked = await withHiddenMoreMenu(menu => {
        const row = menuRows(menu).find(r => describeMoreRow(r)?.key === item.key);
        if (!row) return false;
        row.click();
        return true;
    });
    if (!clicked && item.href) location.assign(item.href);
}
