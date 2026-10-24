/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HIDDEN_ATTR, showCell, TOMBSTONE_ATTR, TWEET_ID_ATTR } from "@filter/controller";
import { Icons } from "@ui/icons";
import { N_, t } from "@utils/i18n";
import { isTombstoneCell, SEL } from "@x/dom";
import definePlugin from "@utils/types";

function restoreAll() {
    for (const cell of document.querySelectorAll(`[${TOMBSTONE_ATTR}]`)) showCell(cell);
}

export default definePlugin({
    name: "TombstoneFilter",
    description: N_("隐藏对话里 X 官方的「此帖子不可用」占位条；根帖本身被删除时保留它的提示。"),
    icon: Icons.eyeOff,
    tags: ["replies", "declutter"],
    enabledByDefault: true,
    dependencies: ["ReplyFilter"],

    events: {
        filterScan({ column, route, rootMounted, active }) {
            if (!active || !route.isStatusRoute || !column) {
                restoreAll();
                return;
            }
            let keptFirst = rootMounted;
            for (const cell of column.querySelectorAll<HTMLElement>(SEL.cell)) {
                if (!isTombstoneCell(cell)) {
                    if (cell.hasAttribute(TOMBSTONE_ATTR)) showCell(cell);
                    continue;
                }
                if (!keptFirst) {
                    keptFirst = true;
                    if (cell.hasAttribute(TOMBSTONE_ATTR)) showCell(cell);
                    continue;
                }
                if (cell.getAttribute(HIDDEN_ATTR) !== "true") cell.setAttribute(HIDDEN_ATTR, "true");
                cell.setAttribute(TWEET_ID_ATTR, "tombstone");
                cell.setAttribute(TOMBSTONE_ATTR, "true");
            }
        },
        filterStopped: restoreAll,
        filterRouteChanged: restoreAll,
    },

    stop: restoreAll,
});
