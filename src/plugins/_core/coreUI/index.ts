/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import css from "@ui/base.css";
import { syncTheme } from "@ui/theme";
import { TOOLTIP_CSS } from "@ui/tooltip";
import definePlugin from "@utils/types";

let timer: ReturnType<typeof setInterval> | undefined;

export default definePlugin({
    name: "CoreUI",
    description: "所有界面共用的基础样式、原生风格 tooltip 与主题跟随。",
    tags: ["core"],
    required: true,
    hidden: true,
    managedStyle: `${css}\n${TOOLTIP_CSS}`,

    start() {
        const tick = () => { if (document.body) syncTheme(); };
        tick();
        timer = setInterval(tick, 2000);
    },

    stop() {
        clearInterval(timer);
    },
});
