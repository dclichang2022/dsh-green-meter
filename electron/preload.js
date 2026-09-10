/**
 * Preload bridge: exposes the desktop-only surface to the DSH web page.
 * The dashboard plugin guards on window.greenDesktop, so plain-browser
 * usage (dsh web without the shell) degrades gracefully.
 */
'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('greenDesktop', {
  getGlobalTotals: () => ipcRenderer.invoke('green-desktop:get-global-totals'),
  openLedgerDir: () => ipcRenderer.invoke('green-desktop:open-ledger-dir'),
})
