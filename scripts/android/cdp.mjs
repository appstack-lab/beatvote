// Evaluates a JavaScript expression in a page via the Chrome DevTools Protocol and prints the result as JSON.
// Usage: node scripts/android/cdp.mjs <webSocketDebuggerUrl> '<expression>'
// Promises are awaited, so `(async () => { ... })()` works.
const [url, expression] = process.argv.slice(2);
if (!url || !expression) {
  console.error("usage: node cdp.mjs <webSocketDebuggerUrl> '<expression>'");
  process.exit(2);
}
const ws = new WebSocket(url);
ws.onopen = () =>
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id !== 1) return;
  const r = m.result;
  console.log(JSON.stringify(r?.exceptionDetails ? { exception: r.exceptionDetails.exception?.description } : r?.result?.value, null, 1));
  process.exit(0);
};
setTimeout(() => {
  console.error('timeout');
  process.exit(1);
}, 15000);
