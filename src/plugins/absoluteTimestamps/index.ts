/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Void++ MessageTimestamps for X: posts show 「10-23 14:05」 instead of 「3h」. The date goes into an
// attribute shown through CSS, so X's own text node (which X keeps updating) is never touched.

import { definePluginSettings } from "@api/Settings";
import { Icons } from "@ui/icons";
import definePlugin, { OptionType } from "@utils/types";
import { SEL } from "@x/dom";
import { CHECKS } from "@x/health";

export const ABS_ATTR = "data-xc-abs";
const TIME_SEL = `${SEL.tweet} time[datetime]`;

export type TimeFormat = "smart" | "full" | "seconds";

export const settings = definePluginSettings({
    format: {
        type: OptionType.SELECT,
        label: "显示格式",
        description: "「智能」：今天只显示时间，今年显示月日，更早的显示完整日期。",
        options: [
            { label: "智能（14:05 / 10-23 14:05 / 2025-10-23 14:05）", value: "smart", default: true },
            { label: "完整日期（2026-10-23 14:05）", value: "full" },
            { label: "精确到秒（2026-10-23 14:05:09）", value: "seconds" },
        ],
    },
});

const pad = (n: number) => String(n).padStart(2, "0");

export function formatTime(date: Date, format: TimeFormat, now = new Date()): string {
    const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    const md = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const ymd = `${date.getFullYear()}-${md}`;
    if (format === "seconds") return `${ymd} ${hm}:${pad(date.getSeconds())}`;
    if (format === "full") return `${ymd} ${hm}`;
    if (date.toDateString() === now.toDateString()) return hm;
    if (date.getFullYear() === now.getFullYear()) return `${md} ${hm}`;
    return `${ymd} ${hm}`;
}

function label(time: Element) {
    const date = new Date(time.getAttribute("datetime") ?? "");
    if (Number.isNaN(date.getTime())) return;
    time.setAttribute(ABS_ATTR, formatTime(date, settings.store.format as TimeFormat));
    if (!time.getAttribute("title")) time.setAttribute("title", date.toLocaleString());
}

const relabelAll = () => { for (const t of document.querySelectorAll(TIME_SEL)) label(t); };

let minuteTimer: ReturnType<typeof setInterval> | undefined;

export default definePlugin({
    name: "AbsoluteTimestamps",
    description: "绝对时间：帖子时间从「3 小时」改成「10-23 14:05」这样的具体时间，格式可选。",
    icon: Icons.clock,
    tags: ["timeline", "appearance"],
    settings,
    healthChecks: [CHECKS.postTime],
    // font-size 0 hides X's text; the pseudo element restores the size and line height it inherited from the link.
    // line-height 0 on the time itself keeps its empty strut from growing the row (20px → 25px on real X).
    managedStyle: `time[${ABS_ATTR}] { font-size: 0 !important; line-height: 0 !important; }\ntime[${ABS_ATTR}]::after { content: attr(${ABS_ATTR}); font-size: var(--xc-ts-size, 15px); line-height: var(--xc-ts-lh, 20px); }`,

    elements: {
        [TIME_SEL](time) {
            const { fontSize, lineHeight } = getComputedStyle(time.parentElement ?? time);
            if (fontSize && fontSize !== "0px") time.style.setProperty("--xc-ts-size", fontSize);
            if (lineHeight && lineHeight !== "0px") time.style.setProperty("--xc-ts-lh", lineHeight);
            label(time);
            const observer = new MutationObserver(() => label(time));
            observer.observe(time, { attributes: true, attributeFilter: ["datetime"] });
            return () => observer.disconnect();
        },
    },

    start() {
        // 「Today」 turns into 「yesterday」 at midnight; refresh the smart labels once a minute.
        minuteTimer = setInterval(relabelAll, 60_000);
    },
    stop() {
        clearInterval(minuteTimer);
        for (const t of document.querySelectorAll<HTMLElement>(`[${ABS_ATTR}]`)) {
            t.removeAttribute(ABS_ATTR);
            t.style.removeProperty("--xc-ts-size");
            t.style.removeProperty("--xc-ts-lh");
        }
    },
    onSettingsChange: relabelAll,
});
