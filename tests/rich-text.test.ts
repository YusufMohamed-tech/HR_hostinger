import assert from "node:assert/strict";
import test from "node:test";
import { safeExternalUrl, sanitizeRichTextHtml } from "../src/lib/rich-text";

test("rich-text sanitizer preserves basic formatting and safe links", () => {
  assert.equal(
    sanitizeRichTextHtml('<h2 style="color:red">Title</h2><p>Hello <strong>team</strong> <a href="https://vendor.test/guide" target="_blank">guide</a></p>'),
    '<h2>Title</h2><p>Hello <strong>team</strong> <a href="https://vendor.test/guide" rel="noopener noreferrer">guide</a></p>',
  );
});

test("rich-text sanitizer removes active content, event handlers, and dangerous links", () => {
  assert.equal(
    sanitizeRichTextHtml('<script>alert(1)</script><svg><a onload="alert(2)">bad</a></svg><p onclick="alert(3)">Safe <a href="javascript:alert(4)">link</a></p>'),
    '<p>Safe <a>link</a></p>',
  );
});

test("rich-text sanitizer escapes malformed or unknown markup", () => {
  assert.equal(
    sanitizeRichTextHtml('2 < 3 <img src=x onerror=alert(1)> end'),
    '2 &lt; 3  end',
  );
});

test("external lesson URLs allow only absolute HTTP and HTTPS URLs", () => {
  assert.equal(safeExternalUrl("https://learning.vendor.test/path"), "https://learning.vendor.test/path");
  assert.equal(safeExternalUrl("javascript:alert(1)"), "");
  assert.equal(safeExternalUrl("/relative/path"), "");
  assert.equal(safeExternalUrl("data:text/html,unsafe"), "");
});
