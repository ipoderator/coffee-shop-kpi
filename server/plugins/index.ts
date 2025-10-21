import type { Express } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type PluginModule = {
  register?: (app: Express) => void | Promise<void>;
};

export async function registerPlugins(app: Express): Promise<void> {
  const pluginsDir = path.dirname(fileURLToPath(import.meta.url));
  const entries = await fs.readdir(pluginsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const pluginIndex = path.join(pluginsDir, entry.name, 'index.ts');

    try {
      await fs.access(pluginIndex);
    } catch {
      continue;
    }

    const moduleUrl = pathToFileURL(pluginIndex).href;
    const pluginModule: PluginModule = await import(moduleUrl);

    if (typeof pluginModule.register !== 'function') {
      continue;
    }

    await pluginModule.register(app);
  }
}
