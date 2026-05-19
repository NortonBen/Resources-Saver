import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src-wxt',
  outDir: 'build',
  suppressWarnings: {
    firefoxDataCollection: true,
  },
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Resources Saver',
    short_name: 'Resources Saver',
    version: '0.0.2',
    version_name: '0.0.2',
    description: "Save all of a webpage's files while retaining folder structure.",
    offline_enabled: true,
    minimum_chrome_version: '88',
    permissions: [
      'tabs',
      'downloads',
      'downloads.shelf',
      'activeTab',
      'storage',
      'sidePanel',
      'scripting',
      'webRequest',
    ],
    host_permissions: ['http://*/*', 'https://*/*', 'ftp://*/*', 'file://*/*', '*://*/*'],
    devtools_page: 'entrypoints/devtools/index.html',
    side_panel: {
      default_path: 'entrypoints/sidepanel/index.html',
    },
    icons: {
      16: 'icons/icon16.png',
      24: 'icons/icon24.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      64: 'icons/icon64.png',
      128: 'icons/icon128.png',
      256: 'icons/icon256.png',
    },
    action: {
      default_icon: {
        16: 'icons/icon16.png',
        19: 'icons/icon19.png',
        24: 'icons/icon24.png',
        32: 'icons/icon32.png',
        38: 'icons/icon38.png',
        48: 'icons/icon48.png',
      },
      default_title: 'Resources Saver',
    },
  },
});
