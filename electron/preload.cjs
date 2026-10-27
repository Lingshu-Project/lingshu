const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('inkstone', {
  getFeedbackInfo: () => ipcRenderer.invoke('feedback:info'),
  submitFeedback: (request) => ipcRenderer.invoke('feedback:submit', request),
  openFeedbackWeb: (request) => ipcRenderer.invoke('feedback:web', request),
  openFeedbackLink: (target, issueNumber) => ipcRenderer.invoke('feedback:link', target, issueNumber),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  setLanguage: (language) => ipcRenderer.invoke('preferences:set-language', language),
  setEditorFontSize: (fontSize) => ipcRenderer.invoke('preferences:set-editor-font-size', fontSize),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  getInitialDocument: () => ipcRenderer.invoke('document:initial'),
  newDocument: (content) => ipcRenderer.invoke('document:new', content),
  openDocument: (content) => ipcRenderer.invoke('document:open', content),
  saveDocument: (content, saveAs = false) => ipcRenderer.invoke('document:save', content, saveAs),
  setDirty: (dirty) => ipcRenderer.send('document:dirty', dirty),
  requestClose: (content) => ipcRenderer.invoke('document:close', content),
  onCloseRequested: (listener) => {
    const unsubscribe = subscribe('document:close-requested', listener);
    ipcRenderer.send('renderer:ready');
    return unsubscribe;
  },
  onCommand: (listener) => subscribe('app:command', listener),
  exportDocument: (request) => ipcRenderer.invoke('document:export', request),
  getThemeState: () => ipcRenderer.invoke('theme:state'),
  selectTheme: (id) => ipcRenderer.invoke('theme:select', id),
  importTheme: () => ipcRenderer.invoke('theme:import'),
  openThemeDirectory: async () => {
    const result = await ipcRenderer.invoke('theme:open-directory');
    if (result?.status === 'error') throw new Error(result.error);
  },
});
