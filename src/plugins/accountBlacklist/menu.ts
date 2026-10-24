/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// 「…」 menu entries for the account lists, so an author can be listed without going through the review page.

import type { PostMenuContext, PostMenuItem } from "@plugins/_api/postMenu";
import { Icons } from "@ui/icons";
import { showToast } from "@ui/toast";
import { detectSelfHandle } from "@x/dom";
import { toConfigHandle } from "@x/text";

import { getConfigStore } from "../_api/blockerConfig";
import { getController, isFilterActive } from "../_api/replyFilter";

const handleOf = (ctx: PostMenuContext) => toConfigHandle(ctx.handle);
const notSelf = (ctx: PostMenuContext) => !!handleOf(ctx) && toConfigHandle(detectSelfHandle()) !== handleOf(ctx);

function refilter(handle: string, restore: boolean) {
    if (!isFilterActive()) return;
    const controller = getController();
    if (restore) controller.restoreAuthor(handle);
    else controller.unrestore(handle);
    controller.configurationChanged();
}

export const blacklistMenuItem: PostMenuItem = {
    id: "account-blacklist",
    order: 10,
    icon: Icons.ban,
    visible: notSelf,
    label: ctx => (getConfigStore().findAccount(handleOf(ctx)) ? `从 X Cleaner 黑名单移出 ${handleOf(ctx)}` : `加入 X Cleaner 黑名单：${handleOf(ctx)}`),
    run(ctx) {
        const store = getConfigStore();
        const handle = handleOf(ctx);
        if (store.findAccount(handle)) {
            store.removeBlockedAccount(handle);
            refilter(handle, false);
            showToast(`${handle} 已移出账号黑名单。`, { type: "success" });
            return;
        }
        if (store.config.allowHandles.includes(handle)) {
            showToast(`${handle} 在白名单中，先移出白名单才能加入黑名单。`, { type: "error" });
            return;
        }
        if (!store.addBlockedAccount({ handle, source: "manual" })) {
            showToast("保存设置失败。", { type: "error" });
            return;
        }
        refilter(handle, false);
        showToast(`${handle} 已加入账号黑名单，TA 的回复会被隐藏。`, { type: "success" });
    },
};

export const allowListMenuItem: PostMenuItem = {
    id: "allow-list",
    order: 20,
    icon: Icons.shield,
    visible: notSelf,
    label: ctx => (getConfigStore().config.allowHandles.includes(handleOf(ctx)) ? `从 X Cleaner 白名单移出 ${handleOf(ctx)}` : `加入 X Cleaner 白名单：${handleOf(ctx)}`),
    run(ctx) {
        const store = getConfigStore();
        const handle = handleOf(ctx);
        if (store.config.allowHandles.includes(handle)) {
            store.removeAllowHandle(handle);
            refilter(handle, false);
            showToast(`${handle} 已移出白名单。`, { type: "success" });
            return;
        }
        if (!store.addAllowHandle(handle)) {
            showToast("保存设置失败。", { type: "error" });
            return;
        }
        refilter(handle, true);
        showToast(`${handle} 已加入白名单，TA 的回复不会再被隐藏。`, { type: "success" });
    },
};
