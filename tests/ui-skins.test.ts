import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildUiSettingsInitScript, mergeUiSettings } from "../src/lib/ui-settings";
import {
  DEFAULT_UI_SKIN,
  UI_SKIN_IDS,
  UI_SKIN_REGISTRY,
  getUiSkinChromeColor,
} from "../src/lib/ui-skins";

test("Architecture is the only registered UI skin", () => {
  assert.deepEqual(UI_SKIN_IDS, ["architecture"]);
  assert.equal(DEFAULT_UI_SKIN, "architecture");
  assert.equal(UI_SKIN_REGISTRY.architecture.label, "Architecture");
  assert.equal(getUiSkinChromeColor("architecture", "light"), "#eeebe5");
  assert.equal(getUiSkinChromeColor("architecture", "dark"), "#242220");
});

test("saved skin and color-style values normalize to Architecture and Neutral", () => {
  assert.equal(mergeUiSettings({ uiSkin: "architecture" }).uiSkin, "architecture");
  assert.equal(
    mergeUiSettings({ uiSkin: "classic95" as "architecture" }).uiSkin,
    "architecture",
  );
  assert.equal(mergeUiSettings({ themeVariant: "neutral" }).themeVariant, "neutral");
  assert.equal(
    mergeUiSettings({ themeVariant: "blueprint" as "neutral" }).themeVariant,
    "neutral",
  );

  const initScript = buildUiSettingsInitScript();
  assert.match(initScript, /var skinIds = \["architecture"\]/);
  assert.match(initScript, /themeVariant: pick\(parsed && parsed\.themeVariant, \['neutral'\]/);
  assert.doesNotMatch(initScript, /\b(?:classic95|fieldnotes|blueprint|high-contrast|paper|botanical)\b/);
});

test("the root layout loads only shared and Architecture skin styles", () => {
  const layoutSource = readFileSync("src/app/layout.tsx", "utf8");
  const globalStyles = readFileSync("src/app/globals.css", "utf8");
  const sharedStyles = readFileSync("src/app/skins/shared-structural.css", "utf8");
  const architectureStyles = readFileSync("src/app/skins/architecture.css", "utf8");
  const sharedScaleStyles = readFileSync("src/app/skins/shared-scale.css", "utf8");
  const taskboardSource = readFileSync("src/components/taskboard.tsx", "utf8");
  const optionsSource = readFileSync("src/components/options-page.tsx", "utf8");

  assert.match(layoutSource, /data-ui-skin=\{DEFAULT_UI_SKIN\}/);
  assert.match(layoutSource, /data-theme-variant="neutral"/);
  assert.match(layoutSource, /skins\/shared-structural\.css/);
  assert.match(layoutSource, /skins\/architecture\.css/);
  assert.match(layoutSource, /skins\/shared-scale\.css/);
  assert.doesNotMatch(layoutSource, /skins\/(?:atmospheric|classic95|field-notes)/);

  assert.doesNotMatch(globalStyles, /data-ui-skin=/);
  assert.match(sharedStyles, /data-ui-skin="architecture"/);
  assert.doesNotMatch(sharedStyles, /data-ui-skin="classic95"/);
  assert.match(architectureStyles, /data-ui-skin="architecture"/);
  assert.match(sharedScaleStyles, /Architecture scale contract/);
  assert.match(sharedScaleStyles, /--tb-compact-control-height: 30px/);
  assert.doesNotMatch(sharedScaleStyles, /fieldnotes|field-notes/);
  assert.doesNotMatch(taskboardSource, /FieldNotes|field-notes|isFieldNotes/);
  assert.doesNotMatch(optionsSource, /UI Skin|Color style|themeVariantOptions/);
});
