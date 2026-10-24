import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";

import { bunPlugins, writePluginModule } from "../build";

writePluginModule();
GlobalRegistrator.register({ url: "https://x.com/home" });
Object.assign(globalThis, { IS_DEV: true, VERSION: "test" });
for (const p of bunPlugins) plugin(p);
