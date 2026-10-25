import { rm } from 'node:fs/promises';

// Observe the exact child returned by our launch before requesting shutdown.
export function observeOwnedExit(child, timeoutMs = 15000) {
  let timer;
  const settled = new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const done = () => { clearTimeout(timer); child.removeListener('exit', done); child.removeListener('close', done); resolve(); };
    child.once('close', done);
    timer = setTimeout(() => {
      child.removeListener('exit', done); child.removeListener('close', done);
      resolve(new Error(`Owned Electron PID ${child.pid} did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return settled;
}

export async function finishDesktopCheck({ application, child, temporary, failure, writeReceipt, remove = rm, exitTimeoutMs = 15000, applications = application ? [{ application, child }] : [], closeResources }) {
  const cleanupErrors = [];
  // Save functional evidence even if closing the app or removing its cwd fails.
  try { await writeReceipt({ passed: false, functionalPassed: !failure, failure: failure?.stack, cleanup: 'pending' }); }
  catch (error) { cleanupErrors.push(error); console.error('Desktop functional receipt failed:', error); }
  let liveChild = false;
  for (const owned of applications) {
    const closed = await closeOwnedApplication(owned.application, owned.child, exitTimeoutMs);
    cleanupErrors.push(...closed.errors); liveChild ||= !!closed.exitError;
  }
  if (closeResources) {
    try { await closeResources(); } catch (error) { cleanupErrors.push(error); }
  }
  if (!liveChild) {
    try { await remove(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
    catch (error) { cleanupErrors.push(error); }
  }
  try { await writeReceipt({ passed: !failure && !cleanupErrors.length, functionalPassed: !failure, failure: failure?.stack, cleanup: cleanupErrors.length ? 'failed' : 'completed', cleanupErrors: cleanupErrors.map(error => error.stack) }); }
  catch (error) { cleanupErrors.push(error); console.error('Desktop final receipt failed:', error); }
  if (failure) throw failure;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Desktop check cleanup failed');
}

export async function closeOwnedApplication(application, child, exitTimeoutMs = 15000) {
  const cleanupErrors = [];
    const exited = observeOwnedExit(child, exitTimeoutMs);
    const closing = Promise.resolve().then(() => application.close()).then(() => null, error => error);
    let closeTimer;
    const closeDeadline = new Promise(resolve => { closeTimer = setTimeout(() => resolve(new Error(`Owned Electron close did not complete within ${exitTimeoutMs}ms`)), exitTimeoutMs); });
    const closeError = await Promise.race([closing, closeDeadline]);
    clearTimeout(closeTimer);
    if (closeError) cleanupErrors.push(closeError);
    const exitError = await exited;
    if (exitError && exitError !== closeError) cleanupErrors.push(exitError);
  return { errors: cleanupErrors, exitError };
}
