/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { pageWindow } from "@utils/misc";

import * as XCleaner from "./XCleaner";

const host = pageWindow as { XCleaner?: unknown };
if (window === window.top && !host.XCleaner) {
    Object.defineProperty(host, "XCleaner", { value: XCleaner, configurable: true });
    XCleaner.boot();
}
