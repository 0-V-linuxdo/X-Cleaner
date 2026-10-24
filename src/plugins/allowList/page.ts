/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { LIMITS } from "@config/config";
import { button, pill } from "@plugins/panel/components";
import { bulkSelection, errorLine, section } from "@plugins/panel/kit";
import type { PageInstance, PanelContext } from "@plugins/panel/types";
import { h } from "@ui/h";
import { showToast } from "@ui/toast";
import { N_, t } from "@utils/i18n";
import { toConfigHandle } from "@x/text";

export function createAllowPage(ctx: PanelContext): PageInstance {
    const input = h("input", { class: "xc-input", type: "text", placeholder: "@handle", "aria-label": "@handle", autocomplete: "off" });
    const msg = errorLine();
    const form = h("form", { class: "xc-form" }, h("div", { class: "xc-row" }, input, h("button", { class: "xc-btn xc-btn-primary", type: "submit" }, t("添加"))), msg);
    const list = h("div", { class: "xc-items", role: "list", "aria-label": t("精确账号白名单") });
    const bulk = bulkSelection(t("账号"), [{
        label: N_("移出白名单"),
        kind: "danger",
        confirm: n => t("把 {n} 个账号移出白名单？", { n }),
        run: keys => {
            const drop = new Set(keys);
            return ctx.commit(c => { c.allowHandles = c.allowHandles.filter(x => !drop.has(x)); });
        },
    }]);
    const el = h("div", { class: "xc-page" }, section(t("精确账号白名单")), form, bulk.bar, list);

    form.addEventListener("submit", e => {
        e.preventDefault();
        const handle = toConfigHandle(input.value);
        if (!handle) return msg.show(t("请输入有效的完整 @handle。"));
        const current = ctx.store.config.allowHandles;
        if (!current.includes(handle) && current.length >= LIMITS.allowHandles) return msg.show(t("白名单已满（{max}）。", { max: LIMITS.allowHandles }));
        const ok = ctx.commit(c => {
            c.allowHandles = [...c.allowHandles.filter(x => x !== handle), handle];
            c.blacklists.accounts = c.blacklists.accounts.filter(a => a.handle !== handle);
        });
        if (!ok) return;
        input.value = "";
        msg.show("");
        showToast(t("已加入白名单。"), { type: "success" });
    });

    const render = () => {
        const handles = ctx.store.config.allowHandles;
        bulk.sync(handles, handles);
        if (!handles.length) {
            list.replaceChildren(h("div", { class: "xc-empty" }, t("暂无白名单账号。")));
            return;
        }
        list.replaceChildren(...[...handles].reverse().map(handle => h("div", { class: "xc-item", role: "listitem" },
            bulk.box(handle, handle),
            h("div", { class: "xc-item-main" }, h("div", { class: "xc-item-head" }, h("strong", null, handle), pill(t("最高优先级"), "success"))),
            h("div", { class: "xc-item-actions" }, button(t("移除"), () => ctx.commit(c => { c.allowHandles = c.allowHandles.filter(x => x !== handle); }), { small: true, kind: "danger" })),
        )));
    };

    return { el, update: render, onShow: () => { input.value = ""; msg.show(""); } };
}
