import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";

import { bunPlugins, writePluginModule } from "../build";

writePluginModule();
GlobalRegistrator.register({ url: "https://x.com/home" });
Object.assign(globalThis, { IS_DEV: true, VERSION: "test", REPO_URL: "https://github.com/0-V-linuxdo/X-Cleaner", DOWNLOAD_URL: "https://example.test/X%20Cleaner.user.js" });
for (const p of bunPlugins) plugin(p);
document.documentElement.lang = "zh";
