const box = document.getElementById('enabled');

chrome.storage.sync.get({ enabled: true }, (v) => {
  box.checked = v.enabled !== false;
});

box.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: box.checked });
});
