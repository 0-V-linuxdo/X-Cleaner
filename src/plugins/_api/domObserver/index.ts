/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { defineHook } from "@api/PluginManager";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";

const logger = new Logger("DomObserver");

export type ElementHandler = (el: HTMLElement) => void | (() => void);
export type ElementHooks = Record<string, ElementHandler>;

declare module "@utils/types" {
    interface PluginHooks {
        elements?: ElementHooks;
    }
}

interface Watcher {
    selector: string;
    handler: ElementHandler;
    seen: WeakSet<Element>;
    cleanups: Map<Element, () => void>;
    owner: string;
}

const watchers = new Set<Watcher>();
let observer: MutationObserver | null = null;
let pending: Element[] = [];
let scheduled = false;

function run(watcher: Watcher, el: HTMLElement) {
    if (watcher.seen.has(el)) return;
    watcher.seen.add(el);
    try {
        const cleanup = watcher.handler(el);
        if (typeof cleanup === "function") watcher.cleanups.set(el, cleanup);
    } catch (e) {
        logger.error(`${watcher.owner} handler failed for ${watcher.selector}`, e);
    }
}

function scan(root: ParentNode, list: Iterable<Watcher> = watchers) {
    for (const w of list) {
        if (root instanceof HTMLElement && root.matches(w.selector)) run(w, root);
        for (const el of root.querySelectorAll<HTMLElement>(w.selector)) run(w, el);
    }
}

function flush() {
    scheduled = false;
    const roots = pending;
    pending = [];
    for (const root of roots) if (root.isConnected) scan(root);
    for (const w of watchers) {
        for (const [el, cleanup] of w.cleanups) {
            if (el.isConnected) continue;
            w.cleanups.delete(el);
            try { cleanup(); } catch (e) { logger.error("Cleanup failed", e); }
        }
    }
}

export function rescan() {
    if (document.body) scan(document.body);
}

export function flushNow() {
    flush();
}

function ensureObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver(records => {
        for (const r of records) {
            if (r.type === "childList") { for (const n of r.addedNodes) if (n instanceof Element) pending.push(n); }
            else if (r.target instanceof Element) pending.push(r.target);
        }
        if (!scheduled && pending.length) {
            scheduled = true;
            queueMicrotask(flush);
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

export function watchElements(selector: string, handler: ElementHandler, owner = "anonymous"): () => void {
    const watcher: Watcher = { selector, handler, seen: new WeakSet(), cleanups: new Map(), owner };
    watchers.add(watcher);
    ensureObserver();
    if (document.documentElement) scan(document.documentElement, [watcher]);
    return () => {
        watchers.delete(watcher);
        for (const cleanup of watcher.cleanups.values()) {
            try { cleanup(); } catch (e) { logger.error("Cleanup failed", e); }
        }
        watcher.cleanups.clear();
    };
}

export function reprocess(el: Element) {
    for (const w of watchers) {
        w.seen.delete(el);
        w.cleanups.get(el)?.();
        w.cleanups.delete(el);
    }
    scan(el.parentElement ?? el);
}

export default definePlugin({
    name: "DomObserverAPI",
    description: "Shared MutationObserver that lets plugins react to elements as X renders them.",
    tags: ["core"],
    required: true,
    hidden: true,

    start() {
        if (document.documentElement) ensureObserver();
        else document.addEventListener("readystatechange", ensureObserver, { once: true });
    },

    stop() {
        observer?.disconnect();
        observer = null;
    },
});

defineHook("elements", {
    provider: "DomObserverAPI",
    attach(plugin, hooks) {
        const offs = Object.entries(hooks).map(([selector, handler]) => watchElements(selector, handler.bind(plugin), plugin.name));
        return () => { for (const off of offs) off(); };
    },
});
