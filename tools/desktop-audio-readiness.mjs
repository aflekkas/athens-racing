// Native QA only: the device unlock and asynchronous recording preparation have
// separate contracts, bounded by the same free-roam entry deadline.
export function remainingEntryTime(deadline, maximumMs, reserveMs = 0, now = Date.now()) {
  const remaining = Math.floor(deadline - now - reserveMs);
  if (![deadline, maximumMs, reserveMs, now].every(Number.isFinite) || maximumMs <= 0 || reserveMs < 0 || remaining <= 0) {
    throw new Error('Free-roam entry deadline exhausted before audio/PCM acceptance');
  }
  return Math.min(maximumMs, remaining);
}

// Passed directly to Playwright; keep this function independent of module scope.
export async function recordedEngineReadinessInPage({ timeoutMs, expectedCar }) {
  const began = performance.now(), view = window.__athens, audio = view?.audio;
  const context = audio?.ctx, engineReady = audio?.engineReady;
  const snapshot = () => {
    let health = null, healthError = null;
    try { health = audio?.health?.(); } catch (error) { healthError = String(error); }
    return { context: audio?.ctx?.state ?? null, currentTime: audio?.ctx?.currentTime ?? null,
      sampleRate: audio?.ctx?.sampleRate ?? null, selectedCar: audio?.engineSpec?.id ?? null,
      playerCar: view?.player?.spec?.id ?? null, recording: audio?.recordingState ?? null,
      engineVoice: !!audio?.engineVoice, recordedBank: !!audio?.recordedBank,
      hidden: document.hidden, focused: document.hasFocus(), health, healthError };
  };
  const resources = () => performance.getEntriesByType('resource')
    .filter(entry => entry.name.includes('/audio/engines/')).slice(-32)
    .map(entry => ({ name: entry.name, startTime: entry.startTime, duration: entry.duration,
      responseEnd: entry.responseEnd, transferSize: entry.transferSize, decodedBodySize: entry.decodedBodySize }));
  const report = { timeoutMs, expectedCar, beganMs: began, before: snapshot(), resourcesBefore: resources(),
    diagnosticScope: 'Resource timings and actual engineReady completion; decode/granular preparation have no separate production timing hooks.' };
  let timer;
  try {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000 || typeof expectedCar !== 'string' || !expectedCar) throw new Error('Invalid bounded recording preparation request');
    if (!audio || !engineReady || typeof engineReady.then !== 'function') throw new Error('Production engineReady promise is missing');
    const result = await Promise.race([
      Promise.resolve(engineReady).then(() => ({ kind: 'resolved' }), error => ({ kind: 'rejected', message: String(error) })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs); }),
    ]);
    report.promiseOutcome = result.kind;
    if (result.kind === 'timeout') throw new Error('Production engineReady did not complete within its remaining entry budget');
    if (result.kind === 'rejected') throw new Error('Production engineReady rejected: ' + result.message);
    const ready = snapshot();
    if (ready.recording !== 'recorded' || !ready.recordedBank) throw new Error('Production engineReady completed without a recorded bank: ' + ready.recording);
    if (audio.ctx !== context || audio.engineReady !== engineReady || ready.context !== 'running' || !ready.engineVoice || ready.selectedCar !== expectedCar || ready.playerCar !== expectedCar || window.__athens?.audio !== audio || audio !== window.__bootAudio) {
      throw new Error('Recorded engine completed with a changed context, readiness promise, voice, car or shared graph');
    }
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.failure = String(error);
  } finally {
    clearTimeout(timer);
    report.finishedMs = performance.now();
    report.elapsedMs = report.finishedMs - began;
    report.after = snapshot();
    report.resourcesAfter = resources();
  }
  return report;
}

export async function waitForRecordedEngine(page, options) {
  const report = await page.evaluate(recordedEngineReadinessInPage, options);
  if (!report.passed) {
    const error = new Error('Native recorded-engine readiness failed: ' + report.failure);
    error.readiness = report;
    throw error;
  }
  return report;
}
