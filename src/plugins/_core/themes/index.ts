/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { watchUserStyles } from "@api/Themes";
import { N_, t } from "@utils/i18n";
import definePlugin from "@utils/types";

let stop: (() => void) | null = null;

export default definePlugin({
    name: "UserStyles",
    description: N_("应用插件管理里「主题」和「快速 CSS」两个标签页的自定义样式。"),
    tags: ["core", "appearance"],
    required: true,
    hidden: true,

    start() {
        stop = watchUserStyles();
    },

    stop() {
        stop?.();
        stop = null;
    },
});
