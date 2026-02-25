const fs = require("fs");
const path = require("path");

describe("KIMI references removed", () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, "../../public/index.html"), "utf8");
  const serverJs = fs.readFileSync(path.join(__dirname, "../../server.js"), "utf8");

  test('index.html title should be "OPENCLAW HUD" without KIMI', () => {
    expect(indexHtml).toContain("<title>OPENCLAW HUD</title>");
    expect(indexHtml).not.toMatch(/KIMI/i);
  });

  test("index.html should not have KIMI subtitle", () => {
    expect(indexHtml).not.toMatch(/KIMI K2\.5/);
    expect(indexHtml).not.toMatch(/COMMAND CENTER/);
  });

  test("server.js banner should not reference KIMI", () => {
    expect(serverJs).not.toMatch(/KIMI/i);
    expect(serverJs).toMatch(/OPENCLAW HUD/);
  });
});
