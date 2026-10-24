/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export type XTheme = "light" | "dim" | "dark";

export function detectTheme(): XTheme {
    const bg = document.body ? getComputedStyle(document.body).backgroundColor : "";
    const m = bg.match(/\d+/g)?.map(Number);
    if (!m || m.length < 3 || (m.length > 3 && m[3] === 0)) return matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const [r, g, b] = m;
    if (r + g + b > 384) return "light";
    return b > 30 ? "dim" : "dark";
}

export function syncTheme() {
    document.documentElement.dataset.xcTheme = detectTheme();
}
