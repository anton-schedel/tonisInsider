import { describe, it, expect } from "vitest";
import { sanitizeBody } from "./sanitize.ts";

describe("sanitizeBody", () => {
  it("keeps allowed formatting", () => {
    expect(sanitizeBody("<p>Laut <i>Sport Bild</i> <b>live</b></p><h3>Termine</h3>"))
      .toBe("<p>Laut <i>Sport Bild</i> <b>live</b></p><h3>Termine</h3>");
  });

  it("removes ad containers, scripts, images and unknown attributes", () => {
    const html = `<p class="x" style="color:red">A</p><div id="ad_oop"><span>AD</span></div><script>alert(1)</script><img src="x.jpg"><p onclick="x()">B</p>`;
    expect(sanitizeBody(html)).toBe("<p>A</p><p>B</p>");
  });

  it("unwraps unknown tags but keeps their text", () => {
    expect(sanitizeBody("<p><span>Hallo <u>Welt</u></span></p>")).toBe("<p>Hallo Welt</p>");
  });

  it("keeps external links (opening in a new tab) and unwraps relative or javascript links", () => {
    expect(sanitizeBody(`<p><a class="online" href="https://youtube.com/x" target="_b">YouTube</a></p>`))
      .toBe(`<p><a href="https://youtube.com/x" target="_blank" rel="noopener noreferrer">YouTube</a></p>`);
    expect(sanitizeBody(`<p><a href="/spieler_1/">Spieler</a> <a href="javascript:alert(1)">x</a></p>`))
      .toBe("<p>Spieler x</p>");
  });

  it("escapes text so it cannot inject markup", () => {
    expect(sanitizeBody("<p>1 &lt; 2 &amp; &lt;script&gt;</p>")).toBe("<p>1 &lt; 2 &amp; &lt;script&gt;</p>");
  });

  it("drops empty paragraphs and collapses long runs of line breaks", () => {
    expect(sanitizeBody("<p>A<br><br><br><br>B</p><p> <br> </p>")).toBe("<p>A<br><br>B</p>");
  });
});
