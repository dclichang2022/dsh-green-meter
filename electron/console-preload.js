/**
 * Preload bridge for the console window: a narrow, typed surface over the
 * main process snapshot pipeline. No node integration reaches the page.
 */
'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('greenConsole', {
  getSnapshot: () => ipcRenderer.invoke('console:snapshot'),
  getLogTail: lines => ipcRenderer.invoke('console:log-tail', lines),
  openPath: which => ipcRenderer.invoke('console:open-path', which),
  saveSettings: patch => ipcRenderer.invoke('console:save-settings', patch),
  openChat: () => ipcRenderer.invoke('console:open-chat'),
  exportCsv: () => ipcRenderer.invoke('console:export-csv'),
  debugProbes: () => ipcRenderer.invoke('console:debug-probes'),
  relayRefresh: () => ipcRenderer.invoke('console:relay-refresh'),
  calibrationStart: payload => ipcRenderer.invoke('console:calibration-start', payload),
  calibrationStop: () => ipcRenderer.invoke('console:calibration-stop'),
  clearAlerts: () => ipcRenderer.invoke('console:alerts-clear'),
})
