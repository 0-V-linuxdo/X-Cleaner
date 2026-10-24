/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { dispatch } from "@api/Events";
import { pageWindow } from "@utils/misc";
import definePlugin from "@utils/types";

let lastUrl = location.href;
let restore: (() => void) | null = null;

function check() {
    if (location.href === lastUrl) return;
    const previous = lastUrl;
    lastUrl = location.href;
    dispatch("navigate", { url: lastUrl, previous });
}

export const currentPath = () => location.pathname;

export default definePlugin({
    name: "NavigationAPI",
    description: "Emits a navigate event whenever X changes the page without reloading.",
    tags: ["core"],
    required: true,
    hidden: true,

    start() {
        const history = (pageWindow as typeof window).history ?? window.history;
        const push = history.pushState;
        const replace = history.replaceState;
        history.pushState = function (...args: Parameters<History["pushState"]>) {
            const r = push.apply(this, args);
            queueMicrotask(check);
            return r;
        };
        history.replaceState = function (...args: Parameters<History["replaceState"]>) {
            const r = replace.apply(this, args);
            queueMicrotask(check);
            return r;
        };
        addEventListener("popstate", check);
        const timer = setInterval(check, 1000);
        restore = () => {
            history.pushState = push;
            history.replaceState = replace;
            removeEventListener("popstate", check);
            clearInterval(timer);
        };
    },

    stop() {
        restore?.();
        restore = null;
    },
});
