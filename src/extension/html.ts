function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
export function webviewHtml(resources: { script: string; style: string; source: string; nonce: string }): string {
  const { script, style, source, nonce } = Object.fromEntries(
    Object.entries(resources).map(([key, value]) => [key, escapeAttribute(value)]),
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${source}; connect-src 'none'; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenCode</title><link rel="stylesheet" href="${style}"></head>
<body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
}
