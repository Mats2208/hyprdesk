import { describe, it, expect } from "vitest";
import { normalize } from "./BrowserTile";

// El bug que pagó este archivo: escribir `dolarbluebolivia.click` en la barra salía como
// `http://…`, y en macOS eso es una página EN BLANCO. WKWebView hereda App Transport Security, que
// bloquea la carga en texto plano y la corta ANTES de que el 301 del sitio a https se ejecute — así
// que ni siquiera se arregla sola por el redirect. Sin error visible: blanco.
describe("normalize", () => {
  it("un dominio pelado sale en https, no en http", () => {
    expect(normalize("dolarbluebolivia.click")).toBe("https://dolarbluebolivia.click");
    expect(normalize("www.google.com/search?q=a")).toBe("https://www.google.com/search?q=a");
  });

  it("un http:// EXPLÍCITO a un host externo se upgradea: tal cual no carga nunca", () => {
    expect(normalize("http://www.dolarbluebolivia.click")).toBe("https://www.dolarbluebolivia.click/");
  });

  it("loopback se queda en http — es el dev-server, y ATS exceptúa localhost", () => {
    expect(normalize("localhost:3000")).toBe("http://localhost:3000");
    expect(normalize("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(normalize("http://localhost:5173")).toBe("http://localhost:5173");
  });

  it("no toca lo que ya venía bien", () => {
    expect(normalize("https://anthropic.com")).toBe("https://anthropic.com");
    expect(normalize("file:///tmp/x.html")).toBe("file:///tmp/x.html");
    expect(normalize("about:blank")).toBe("about:blank");
    expect(normalize("  ")).toBe("");
  });
});
