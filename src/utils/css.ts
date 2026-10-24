/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const registry = new Map<string, string>();
const active = new Map<string, HTMLStyleElement>();
let root: HTMLElement | null = null;

function container(): HTMLElement | null {
    if (root?.isConnected) return root;
    const parent = document.head ?? document.documentElement;
    if (!parent) return null;
    root = document.createElement("xc-styles");
    root.hidden = true;
    parent.appendChild(root);
    for (const [name, el] of active) if (!el.isConnected) root.appendChild(el);
    return root;
}

export function registerStyle(name: string, css: string) {
    registry.set(name, css);
    const existing = active.get(name);
    if (existing) {
        if (existing.textContent !== css) existing.textContent = css;
        existing.disabled = false;
        if (!existing.isConnected) container()?.appendChild(existing);
        return;
    }
    const el = document.createElement("style");
    el.dataset.xc = name;
    el.textContent = css;
    active.set(name, el);
    container()?.appendChild(el);
}

export function unregisterStyle(name: string) {
    active.get(name)?.remove();
    active.delete(name);
    registry.delete(name);
}

export function enableStyle(name: string) {
    const css = registry.get(name);
    if (css != null) registerStyle(name, css);
}

export function disableStyle(name: string) {
    const el = active.get(name);
    if (el) el.disabled = true;
}

export const isStyleActive = (name: string) => !!active.get(name) && !active.get(name)!.disabled;

export const classNameFactory = (prefix: string) => (...names: Array<string | false | null | undefined>) =>
    names.filter(Boolean).map(n => prefix + n).join(" ");

export const cl = classNameFactory("xc-");
