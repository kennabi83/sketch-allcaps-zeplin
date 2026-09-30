# Citics · ALLCAPS

A Sketch plugin that makes uppercase labels survive the trip to Zeplin.

**Bake** real uppercase into your strings → sync to Zeplin → **Restore** the original casing. Pixel-identical in Sketch, fully reversible.

---

## The problem

In Sketch, `AA` (ALLCAPS) is a **display attribute**, not the text itself.

A layer that reads `NGÂN HÀNG ĐĂNG KÝ VAY` on canvas actually stores:

| | |
|---|---|
| string | `Ngân hàng đăng ký vay` |
| `MSAttributedStringTextTransformAttribute` | `1` (uppercase) |

That attribute never reaches the handoff:

- **Sketch → Copy CSS Attributes** omits it. You get `font-family`, `font-size`, `color`, `letter-spacing`, `line-height` — and nothing about casing.
- **Zeplin has no field to put it in.** Verified against the Zeplin REST API across two projects and 60+ text runs: a text layer's `style` object carries exactly ten keys and none of them is a transform.

  ```
  postscript_name · font_family · font_size · font_weight · font_style
  font_stretch · line_height · letter_spacing · text_align · color
  ```

So the developer sees a screenshot rendered in CAPS, a string in sentence case, and no CSS rule explaining the gap. They either hard-code the wrong casing or come back and ask.

### Why a plugin cannot simply "add the property"

This was the first thing we tried to rule out. It cannot work:

- A third-party plugin does not get to inject fields into the payload Zeplin's own plugin uploads. Zeplin builds that payload itself and its server validates against a fixed schema.
- A **Zeplin extension** only reads data that already reached the server. Nothing was uploaded, so nothing can be generated.
- Renaming shared text styles so the name hints at the transform does not help either, at least not by default: unless the project is connected to a **styleguide**, Zeplin does not carry style names — in our projects `/projects/{id}/text_styles` is empty and text runs have no `source_id`.

The data model has no slot for it. The only thing left is to put the casing where Zeplin *does* look: **in the string**.

---

## What the plugin does

**Bake** walks every text layer whose transform is uppercase and:

1. stores the original string on the layer itself,
2. replaces the string with its real uppercase form,
3. turns the transform off.

The canvas does not move by a single pixel, because the layer was already *rendering* uppercase at that width. Verified with `ImageChops.difference(...).getbbox() == None` on three separate artboards across two files, before → baked → restored.

**Restore** puts every original string back and switches the transform on again. Verified byte-for-byte against a snapshot taken before baking (identical checksum, 173 layers, 8,498 characters).

**Select baked artboards** selects exactly the artboards Bake touched, so you can hand them straight to Zeplin's "Export Selected Artboards" instead of re-exporting the whole file.

### Symbol overrides are handled

If a text layer inside a symbol master is uppercase and an instance overrides that text, the override carries the casing too. Bake rewrites those override values and records them, and Restore puts them back. In one of our files this covered 475 overrides that would otherwise have shipped in the wrong case.

---

## Commands

Menu: **Plugins → Citics · ALLCAPS**

| Command | What it does | Shortcut |
|---|---|---|
| Count — current page / whole file | Reports how many layers and overrides are uppercase. Run it first; it changes nothing. | |
| Bake — current page / whole file | Writes real uppercase, remembers the originals, records which artboards were touched. | |
| Select baked artboards — this page | Selects the baked artboards on the page you are on, and tells you how many pages are left. | `⌃⇧A` |
| Select baked artboards — next page | Jumps to the next page that has baked artboards and selects them there. | `⌃⇧N` |
| Restore — current page / whole file | Puts the original strings back and re-enables the transform. | |

There are two scopes because Sketch keeps **one selection per page** — you cannot select artboards across several pages at once. Page switching *is* scriptable, so `⌃⇧N` walks you through the pages one sync at a time.

---

## Workflow

```
Count — whole file          see what you are about to touch
Bake — whole file           strings become real uppercase
⌃⇧A                         baked artboards get selected
sync to Zeplin              export the selection
⌃⇧N → sync → ⌃⇧N → sync     repeat for each remaining page
Restore — whole file        design file back to normal
```

Undo does **not** rely on Sketch's undo stack. Originals live on the layers themselves (`Settings.setLayerSettingForKey`), so you can close the file, reopen it tomorrow and still restore.

---

## Install

```bash
git clone <this repo>
cd sketch-allcaps-zeplin
./install.sh
```

`install.sh` symlinks the bundle into `~/Library/Application Support/com.bohemiancoding.sketch3/Plugins/`, moving any existing copy aside as a backup. Restart Sketch afterwards.

To install without cloning, drop `CiticsAllCaps.sketchplugin` into that Plugins folder.

---

## Limits, read these

- **Dynamic text is not solved by baking.** Customer names, addresses and anything else coming from an API are uppercase in the design but not in the data. Those belong in a CSS rule on the component, ideally declared once on the design-system token. Baking is for static UI chrome.
- **Bake and Restore must both be run from the menu.** Sketch scopes plugin settings to the calling plugin, so a script run from anywhere else cannot read what this plugin stored. Mixing the two means you cannot restore.
- **Bake — whole file is slow on large documents.** One of our files has ~6,000 symbol instances. Wait for the toast.
- **Uppercasing is locale-independent** (`toUpperCase` after NFC normalisation). Correct for Vietnamese. Languages where casing is locale-sensitive — Turkish dotless i, German ß — would need a different mapping.
- The plugin reports through Sketch's toast at the bottom of the canvas, not a dialog. No toast means it did not run; see below.

---

## Development notes

Two traps cost real time here. Both are written into the source as well.

### 1. COSPreprocessor eats square brackets

Sketch runs plugin command scripts through `COSPreprocessor` (`preprocessForObjCMessagesToJS:` in `CocoaScript.framework`), which rewrites Objective-C message syntax into JavaScript. A subscript whose contents include a function call, a dot or a space can be mistaken for a message send, and the script dies with:

```
SyntaxError: Unexpected token '('. Expected a property name after '.'
```

This happens **while the script is loading**, so no handler runs and nothing appears on screen. Clicking the menu looks like a no-op.

Rule: **a subscript may contain only a single variable name or a number.** Assign anything else to a variable first. The rule applies inside comments and string literals too — the preprocessor is regex based and does not skip them.

Things that do not help:

- `node --check` passes happily; the JavaScript is valid, the damage happens after rewriting.
- Loading the file with `require()` from a console works fine; that path is **not** preprocessed, so it hides the bug. This produced a false "verified" once.

The only reliable signal is the log:

```
~/Library/Logs/com.bohemiancoding.sketch3/Plugin Log.log
```

`grep` the source for hazardous subscripts before shipping:

```bash
grep -nE '\[[^]]*[ .(][^]]*\]' CiticsAllCaps.sketchplugin/Contents/Sketch/allcaps.js
```

### 2. Layer settings are scoped per plugin

`Settings.setLayerSettingForKey` / `layerSettingForKey` key off the **calling plugin's identifier**. Code running as a different plugin — including a scripting console — reads back `null` even though the data is there. To inspect it for real, open the `.sketch` file (it is a zip) and look at each layer's `userInfo`:

```json
"userInfo": { "vn.citics.allcaps": { "citicsAllCapsOrig": "Ngân hàng đăng ký vay" } }
```

### Ordering inside Bake

Overrides are processed **before** text layers. Once a master's transform is switched off there is no way left to tell which layers used to be uppercase.

### Recognising uppercase overrides cheaply

Matching `o.affectedLayer` across thousands of instances freezes Sketch. Instead the plugin pre-computes the set of uppercase text-layer ids once, then matches the trailing id segment of each override id — no layer resolution needed.

---

## Verification performed

| Check | Result |
|---|---|
| Bake on 39 layers, pixel diff | identical, `bbox = None` |
| Restore, compared to on-disk snapshot | byte-for-byte identical |
| Bake on 173 layers, pixel diff | identical |
| Restore, checksum | matched exactly |
| Bake including 45 symbol overrides, pixel diff | identical |
| Restore of overrides | 0 mismatches, 0 leftover stored data |

---

## Scale of the problem in our files

A scan of 25 Sketch cloud documents found **14,292 layers** using the uppercase transform: 8,219 inherited from **26 shared text styles**, 6,073 set directly on the layer. The heaviest styles are `ALL CAP CONTENT` (5,336 layers), `Headline 3` (616) and `Web/Label` (489).

The shared-style half is worth fixing at the source: declare `text-transform: uppercase` on the corresponding design-system token and developers never need the per-layer answer. Baking covers the rest, and covers the gap until that lands.
