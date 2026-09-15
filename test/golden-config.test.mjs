import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createConfigFromInput } from "../src/config/normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "fixtures", "minimal-wp");

// Golden fixture: raw config input → normalized config.
//
// This regression harness protects the shape of createConfigFromInput's
// output across the modularisation phase. If a modularisation PR touches
// this shape without a deliberate reason, the diff makes it visible.

test("golden fixture minimal-wp: createConfigFromInput matches expected shape", async () => {
  const inputRaw = await fs.readFile(path.join(FIXTURE_DIR, "config-input.json"), "utf8");
  const expectedRaw = await fs.readFile(path.join(FIXTURE_DIR, "config-expected.json"), "utf8");
  const input = JSON.parse(inputRaw);
  const expected = JSON.parse(expectedRaw);

  const actual = await createConfigFromInput(input);
  assert.deepEqual(actual, expected);
});
