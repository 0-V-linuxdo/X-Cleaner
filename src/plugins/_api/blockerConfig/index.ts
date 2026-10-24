/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createGmBackend, type KeyValueBackend } from "@config/backend";
import { ConfigStore } from "@config/store";
import definePlugin from "@utils/types";

let store: ConfigStore | null = null;
let backend: KeyValueBackend | null = null;

export function getBackend(): KeyValueBackend {
    return backend ??= createGmBackend();
}

export function getConfigStore(): ConfigStore {
    return store ??= new ConfigStore(getBackend());
}

export function useBackend(next: KeyValueBackend) {
    store?.dispose();
    backend = next;
    store = null;
}

export default definePlugin({
    name: "BlockerConfig",
    description: "屏蔽配置存储：默认值、规范化、导入导出、跨标签同步，API key 单独保存。",
    tags: ["core"],
    required: true,
    hidden: true,
    start() {
        getConfigStore();
    },
});
