import { execSync } from "node:child_process";
import { registerPluginHooksFromDir } from "openclaw/plugin-sdk";

export default {
  id: "openclaw-plugin-plakar",
  name: "Plakar Backup",

  register(api) {
    // Graceful degradation 1: plakar binary must be in PATH
    try {
      execSync("which plakar", { stdio: "ignore" });
    } catch {
      api.logger.warn(
        "[plakar] 'plakar' binary not found in PATH — snapshots disabled.\n" +
        "         Install: https://docs.plakar.io/install\n" +
        "         Then restart OpenClaw and set plakar.store in your config."
      );
      return;
    }

    // Graceful degradation 2: store must be configured
    const store = api.config.get("plakar.store");
    if (!store) {
      api.logger.warn(
        "[plakar] plakar.store not configured — snapshots disabled.\n" +
        "         Set it with: openclaw config set plakar.store <path-or-url>"
      );
      return;
    }

    api.logger.info("[plakar] plugin registered — store: " + store);
    registerPluginHooksFromDir(api, "./hooks");
  },
};
