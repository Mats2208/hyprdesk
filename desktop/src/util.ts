// util.ts — helpers compartidos.

// Decodifica base64 (bytes crudos del PTY) a Uint8Array.
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Quita secuencias ANSI/escape para pasarle texto limpio al router.
// Cubre CSI, OSC, designación de charset (ej. ESC ( B) y control chars sueltos.
export function stripAnsi(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "") // CSI  (ej. [>4m, [<u)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[()*+][\x20-\x2f]*[\x30-\x7e]/g, "") // charset (ej. ESC ( B)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[@-Z\\-_]/g, "") // otras secuencias ESC
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "") // control chars sueltos
    .replace(/\r/g, "");
}
