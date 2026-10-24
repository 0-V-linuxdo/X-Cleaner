/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { h } from "@ui/h";
import { showToast } from "@ui/toast";

import { getRuleStats } from "../ruleStats";
import { button, pill, searchBox } from "./components";

export function hitPill(key: string): HTMLElement {
    const n = getRuleStats()?.count(key) ?? 0;
    return pill(`${n} 次`, n ? "accent" : "muted", `累计隐藏 ${n} 条不重复回复`);
}

export interface PageHeader {
    el: HTMLElement;
    query(): string;
    clearQuery(): void;
    update(): void;
}

/** Search box, "清除统计" button and the per-page hit summary shared by the blacklist subpages. */
export function pageHeader(label: string, keys: () => string[], onSearch: () => void): PageHeader {
    let q = "";
    const input = searchBox(`搜索${label}`, "", v => {
        q = v;
        const { selectionStart, selectionEnd } = input;
        onSearch();
        if (document.activeElement !== input) {
            input.focus();
            input.setSelectionRange(selectionStart, selectionEnd);
        }
    });
    const summary = h("p", { class: "xc-page-summary xc-muted" });
    const clear = button("清除统计", () => {
        if (!confirm("清除全部规则命中统计？隐藏记录不会被删除。")) return;
        getRuleStats()?.clear();
        showToast("规则命中统计已清除。", { type: "success" });
    }, { small: true });
    const update = () => {
        const total = getRuleStats()?.total(keys()) ?? 0;
        summary.textContent = `本页规则累计隐藏 ${total} 条不重复回复。`;
        clear.disabled = total === 0;
    };
    update();
    return {
        el: h("div", { class: "xc-page-head" }, h("div", { class: "xc-row" }, input, clear), summary),
        query: () => q.trim().toLowerCase(),
        clearQuery: () => { q = ""; input.value = ""; },
        update,
    };
}

export function section(title: string, ...extra: (Node | null)[]): HTMLElement {
    return h("div", { class: "xc-section-head" }, h("h3", { class: "xc-section-title" }, title), ...extra);
}

export type MsgKind = "error" | "warning" | "success" | "info";
export type MessageLine = HTMLElement & { show(msg: string, kind?: MsgKind): void };

export function errorLine(): MessageLine {
    const el = h("p", { class: "xc-form-msg", role: "status", hidden: true });
    return Object.assign(el, {
        show(msg: string, kind: MsgKind = "error") {
            el.textContent = msg;
            el.hidden = !msg;
            el.dataset.kind = kind;
        },
    });
}

export function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
    return !q || fields.some(f => f?.toLowerCase().includes(q));
}

/** A labelled checkbox row bound to one config flag. */
export function checkRow(label: string, get: () => boolean, set: (v: boolean) => void, description?: string): HTMLElement & { sync(): void } {
    const box = h("input", { type: "checkbox" });
    box.addEventListener("change", () => set(box.checked));
    const row = h("label", { class: "xc-toggle-row" },
        h("span", { class: "xc-item-main" }, h("strong", null, label), description ? h("span", { class: "xc-muted", style: "font-size:12.5px" }, description) : null),
        box,
    );
    const sync = () => { box.checked = get(); };
    sync();
    return Object.assign(row, { sync });
}

export interface BulkAction {
    label: string;
    kind?: "danger";
    /** Shown in a confirm() before running; omit to run straight away. */
    confirm?(count: number): string;
    /** Returns false when nothing was saved, so the selection is kept. */
    run(keys: string[]): boolean;
}

export interface BulkSelection {
    bar: HTMLElement;
    /** A checkbox for one row; clicks on it never reach the row underneath. */
    box(key: string, label: string): HTMLInputElement;
    /** Drops keys that no longer exist and remembers which rows are on screen for 「全选」. */
    sync(existing: string[], visible: string[]): void;
}

/** Void++ SelectionUI for the list pages: tick rows, then act on all of them at once. */
export function bulkSelection(noun: string, actions: BulkAction[]): BulkSelection {
    const selected = new Set<string>();
    let visible: string[] = [];
    const boxes = new Map<string, HTMLInputElement>();
    const count = h("span", { class: "xc-bulk-count" });
    const refresh = () => {
        bar.hidden = selected.size === 0;
        count.textContent = `已选 ${selected.size} 个${noun}`;
        for (const [key, box] of boxes) box.checked = selected.has(key);
    };
    const bar: HTMLElement = h("div", { class: "xc-bulk-bar", role: "toolbar", "aria-label": `批量操作${noun}` }, count,
        h("div", { class: "xc-bulk-actions" },
            button("全选", () => { for (const k of visible) selected.add(k); refresh(); }, { small: true }),
            button("取消选择", () => { selected.clear(); refresh(); }, { small: true }),
            ...actions.map(a => button(a.label, () => {
                const keys = [...selected];
                if (!keys.length || (a.confirm && !confirm(a.confirm(keys.length)))) return;
                if (a.run(keys) === false) return;
                selected.clear();
                refresh();
            }, { small: true, kind: a.kind ?? "" }))));
    refresh();
    return {
        bar,
        box(key, label) {
            const box = h("input", { type: "checkbox", class: "xc-bulk-box", "aria-label": `选择 ${label}` });
            box.checked = selected.has(key);
            box.addEventListener("click", e => e.stopPropagation());
            box.addEventListener("keydown", e => e.stopPropagation());
            box.addEventListener("change", () => {
                if (box.checked) selected.add(key);
                else selected.delete(key);
                refresh();
            });
            boxes.set(key, box);
            return box;
        },
        sync(existing, shown) {
            const keep = new Set(existing);
            for (const k of [...selected]) if (!keep.has(k)) selected.delete(k);
            visible = shown;
            boxes.clear();
            refresh();
        },
    };
}
