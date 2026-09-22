// Fetches a standalone HTML file and injects its content into a live
// `container` element in THIS document — never an iframe, so nothing about
// it reloads if the container later gets moved (e.g. wrapped in a
// CSS3DObject and reparented into the 3D scene, see intro.ts).
//
// Content files author their top-level presentation against a
// `.content-root` selector (in addition to `body`, so they still preview
// correctly if opened directly) — `container` is expected to already carry
// that class before calling this.

export async function injectHtmlFile(url: string, container: HTMLElement): Promise<void> {
  const html = await fetch(url).then((r) => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html");

  // <style> tags go into the real document's <head>, not `container` — that
  // way `:root` custom properties resolve against the actual document root
  // regardless of where `container` sits in the tree.
  for (const styleEl of Array.from(doc.querySelectorAll("style"))) {
    const style = document.createElement("style");
    style.textContent = styleEl.textContent ?? "";
    document.head.appendChild(style);
  }

  container.replaceChildren();
  for (const node of Array.from(doc.body.childNodes)) {
    if (node instanceof HTMLScriptElement) {
      // Scripts parsed via DOMParser are marked "already started" per spec
      // and never auto-execute on insertion (same reason innerHTML-inserted
      // scripts don't run) — recreating via createElement does execute.
      const fresh = document.createElement("script");
      for (const attr of Array.from(node.attributes)) {
        fresh.setAttribute(attr.name, attr.value);
      }
      fresh.textContent = node.textContent;
      container.appendChild(fresh);
    } else {
      container.appendChild(node);
    }
  }
}
