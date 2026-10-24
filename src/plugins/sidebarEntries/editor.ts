/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { switchEl } from "@ui/fields";
import { h } from "@ui/h";

import { HIDE_HINTS, type Layout, mergeOrder, NAV, type SidebarEntry } from "./entries";

interface EditorCtx {
    get(): Layout;
    set(value: Layout): void;
}

const isLive = (key: string, entries: SidebarEntry[]) => {
    const nav = document.querySelector(NAV);
    const entry = entries.find(e => e.key === key);
    return !!(nav && entry && nav.querySelector(`:scope > ${entry.selector}`));
};

export function renderEditor(ctx: EditorCtx, getEntries: () => SidebarEntry[]): HTMLElement {
    const list = h("div", { class: "xc-sbe-list", role: "list", "aria-label": "侧栏入口" });
    let dragKey: string | null = null;

    const current = () => {
        const v = ctx.get() as Partial<Layout> | undefined;
        return { order: [...(v?.order ?? [])], hidden: [...(v?.hidden ?? [])] };
    };

    const save = (order: string[], hidden: string[]) => {
        ctx.set({ order, hidden });
        render();
    };

    const move = (key: string, to: number) => {
        const entries = getEntries();
        const order = mergeOrder(current().order, entries.map(e => e.key)).filter(k => entries.some(e => e.key === k));
        const from = order.indexOf(key);
        if (from < 0 || to < 0 || to >= order.length || from === to) return;
        order.splice(from, 1);
        order.splice(to, 0, key);
        save(order, current().hidden);
        list.querySelector<HTMLElement>(`[data-key=${JSON.stringify(key)}] .xc-sbe-handle`)?.focus();
    };

    const render = () => {
        const entries = getEntries();
        if (!entries.length) {
            list.replaceChildren(h("div", { class: "xc-empty" }, "还没有读到侧栏入口。在 x.com 的桌面版页面打开此设置即可。"));
            return;
        }
        const { order: saved, hidden } = current();
        const byKey = new Map(entries.map(e => [e.key, e]));
        const order = mergeOrder(saved, entries.map(e => e.key)).filter(k => byKey.has(k));
        list.replaceChildren(...order.map((key, i) => {
            const entry = byKey.get(key)!;
            const visible = !hidden.includes(key);
            const handle = h("button", {
                type: "button", class: "xc-sbe-handle", title: "拖动排序，或按 ↑ ↓ 移动", "aria-label": `移动 ${entry.label}`,
                onkeydown: (e: KeyboardEvent) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                        e.preventDefault();
                        move(key, i + (e.key === "ArrowUp" ? -1 : 1));
                    }
                },
            }, "⋮⋮");
            const hint = !visible && HIDE_HINTS[key] ? h("span", { class: "xc-sbe-hint" }, HIDE_HINTS[key]) : null;
            const absent = !isLive(key, entries) ? h("span", { class: "xc-sbe-hint" }, "当前页面没有这个入口") : null;
            const row = h("div", { class: `xc-sbe-row${visible ? "" : " is-hidden"}`, role: "listitem", draggable: "true", dataset: { key } },
                handle,
                h("div", { class: "xc-sbe-main" }, h("strong", null, entry.label), hint, absent),
                h("div", { class: "xc-sbe-actions" },
                    h("button", { type: "button", class: "xc-btn xc-btn-sm xc-btn-icon", "aria-label": `上移 ${entry.label}`, disabled: i === 0, onclick: () => move(key, i - 1) }, "↑"),
                    h("button", { type: "button", class: "xc-btn xc-btn-sm xc-btn-icon", "aria-label": `下移 ${entry.label}`, disabled: i === order.length - 1, onclick: () => move(key, i + 1) }, "↓"),
                    switchEl(visible, on => {
                        const next = current().hidden.filter(k => k !== key);
                        save(current().order, on ? next : [...next, key]);
                    }, `显示 ${entry.label}`),
                ),
            );
            row.addEventListener("dragstart", e => {
                dragKey = key;
                row.classList.add("is-dragging");
                e.dataTransfer?.setData("text/plain", key);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
            });
            row.addEventListener("dragend", () => { dragKey = null; row.classList.remove("is-dragging"); });
            row.addEventListener("dragover", e => {
                if (!dragKey || dragKey === key) return;
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
            });
            row.addEventListener("drop", e => {
                e.preventDefault();
                if (dragKey && dragKey !== key) move(dragKey, i);
            });
            return row;
        }));
    };

    render();
    return h("div", { class: "xc-sbe" }, list);
}
