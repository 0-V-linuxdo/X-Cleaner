/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { switchEl } from "@ui/fields";
import { h, svgIcon } from "@ui/h";
import { t } from "@utils/i18n";

import { HIDE_HINTS, type Layout, mergeOrder, NAV, type SidebarEntry } from "./entries";
import type { MoreItem } from "./pins";

interface EditorCtx {
    get(): Layout;
    set(value: Layout): void;
}

const isLive = (key: string, entries: SidebarEntry[]) => {
    const nav = document.querySelector(NAV);
    const entry = entries.find(e => e.key === key);
    return !!(nav && entry && nav.querySelector(`:scope > ${entry.selector}`));
};

export function renderEditor(ctx: EditorCtx, getEntries: () => SidebarEntry[]): { el: HTMLElement; refresh(): void } {
    const list = h("div", { class: "xc-sbe-list", role: "list", "aria-label": t("侧栏入口") });
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
            list.replaceChildren(h("div", { class: "xc-empty" }, t("还没有读到侧栏入口。在 x.com 的桌面版页面打开此设置即可。")));
            return;
        }
        const { order: saved, hidden } = current();
        const byKey = new Map(entries.map(e => [e.key, e]));
        const order = mergeOrder(saved, entries.map(e => e.key)).filter(k => byKey.has(k));
        list.replaceChildren(...order.map((key, i) => {
            const entry = byKey.get(key)!;
            const visible = !hidden.includes(key);
            const handle = h("button", {
                type: "button", class: "xc-sbe-handle", title: t("拖动排序，或按 ↑ ↓ 移动"), "aria-label": t("移动 {label}", { label: entry.label }),
                onkeydown: (e: KeyboardEvent) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                        e.preventDefault();
                        move(key, i + (e.key === "ArrowUp" ? -1 : 1));
                    }
                },
            }, "⋮⋮");
            const hint = !visible && HIDE_HINTS[key] ? h("span", { class: "xc-sbe-hint" }, t(HIDE_HINTS[key])) : null;
            const absent = !isLive(key, entries) ? h("span", { class: "xc-sbe-hint" }, t("当前页面没有这个入口")) : null;
            const row = h("div", { class: `xc-sbe-row${visible ? "" : " is-hidden"}`, role: "listitem", draggable: "true", dataset: { key } },
                handle,
                h("div", { class: "xc-sbe-main" }, h("strong", null, entry.label), hint, absent),
                h("div", { class: "xc-sbe-actions" },
                    h("button", { type: "button", class: "xc-btn xc-btn-sm xc-btn-icon", "aria-label": t("上移 {label}", { label: entry.label }), disabled: i === 0, onclick: () => move(key, i - 1) }, "↑"),
                    h("button", { type: "button", class: "xc-btn xc-btn-sm xc-btn-icon", "aria-label": t("下移 {label}", { label: entry.label }), disabled: i === order.length - 1, onclick: () => move(key, i + 1) }, "↓"),
                    switchEl(visible, on => {
                        const next = current().hidden.filter(k => k !== key);
                        save(current().order, on ? next : [...next, key]);
                    }, t("显示 {label}", { label: entry.label })),
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
    return { el: h("div", { class: "xc-sbe" }, list), refresh: render };
}

interface PinEditorCtx {
    items(): MoreItem[];
    pinned(): string[];
    setPinned(keys: string[]): void;
    rescan(): Promise<boolean>;
}

/** The rows of X's 「更多」 menu, each with a switch that pins it into the sidebar above 「更多」. */
export function renderPinEditor(ctx: PinEditorCtx): HTMLElement {
    const list = h("div", { class: "xc-sbe-list", role: "list", "aria-label": t("「更多」菜单里的项目") });
    const status = h("span", { class: "xc-sbe-hint" });
    let scanning = false;

    const rescan = async () => {
        if (scanning) return;
        scanning = true;
        status.textContent = t("正在读取「更多」菜单…");
        const ok = await ctx.rescan();
        scanning = false;
        if (!list.isConnected) return;
        status.textContent = ok ? "" : t("没能打开「更多」菜单。在 x.com 的桌面版页面上点一下侧栏的「更多」，再回来这里。");
        render();
    };

    const render = () => {
        const items = ctx.items();
        const pinned = ctx.pinned();
        if (!items.length) {
            list.replaceChildren(h("div", { class: "xc-empty" }, t("还没有读到「更多」菜单的项目。点「读取」，或在侧栏点一下「更多」。")));
            return;
        }
        list.replaceChildren(...items.map(item => {
            const on = pinned.includes(item.key);
            return h("div", { class: "xc-sbe-row", role: "listitem", dataset: { key: item.key } },
                item.icon ? h("span", { class: "xc-sbe-icon" }, svgIcon(item.icon, 18)) : null,
                h("div", { class: "xc-sbe-main" }, h("strong", null, item.label)),
                h("div", { class: "xc-sbe-actions" },
                    switchEl(on, next => {
                        const rest = ctx.pinned().filter(k => k !== item.key);
                        ctx.setPinned(next ? [...rest, item.key] : rest);
                    }, t("固定 {label} 到侧栏", { label: item.label })),
                ),
            );
        }));
    };

    render();
    if (!ctx.items().length) void rescan();
    return h("div", { class: "xc-sbe xc-sbe-pins" },
        h("div", { class: "xc-sbe-head" },
            h("div", { class: "xc-sbe-main" },
                h("strong", null, t("固定「更多」菜单里的项目")),
                h("span", { class: "xc-sbe-hint" }, t("打开的项目会出现在侧栏「更多」的正上方，侧栏收起成图标时也一样。固定后可以在上面的列表里调整位置。")),
            ),
            h("button", { type: "button", class: "xc-btn xc-btn-sm", onclick: () => void rescan() }, t("读取")),
        ),
        status,
        list,
    );
}
