const secretInput = document.getElementById('secret');
const ocrKeyInput = document.getElementById('ocrKey');
const statusEl = document.getElementById('status');

async function loadState() {
  const { ingestSecret, ocrApiKey, lastRun, lastResult } = await chrome.storage.local.get([
    'ingestSecret',
    'ocrApiKey',
    'lastRun',
    'lastResult',
  ]);
  if (ingestSecret) secretInput.value = ingestSecret;
  if (ocrApiKey) ocrKeyInput.value = ocrApiKey;
  if (lastRun) {
    statusEl.textContent = `마지막 실행: ${lastRun}\n${JSON.stringify(lastResult, null, 1)}`;
  }
}

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    ingestSecret: secretInput.value.trim(),
    ocrApiKey: ocrKeyInput.value.trim(),
  });
  statusEl.textContent = '저장했습니다.';
});

document.getElementById('runNow').addEventListener('click', async () => {
  statusEl.textContent = '수집 중... (몇 초 걸릴 수 있어요)';
  const result = await chrome.runtime.sendMessage({ type: 'RUN_NOW' });
  statusEl.textContent = JSON.stringify(result, null, 1);
});

loadState();
