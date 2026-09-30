// Citics - ALLCAPS: bake / restore / select baked artboards
//
// WHY THIS EXISTS
// Sketch stores ALLCAPS as a display attribute (MSAttributedStringTextTransformAttribute);
// the underlying string stays in its original casing. Zeplin has NO field for
// text-transform: its `style` object only carries postscript_name, font_family,
// font_size, font_weight, font_style, font_stretch, line_height, letter_spacing,
// text_align and color. So the only way developers see the right casing is to bake
// real uppercase into the strings before syncing.
//
// WORKFLOW:  Bake whole file  ->  Select baked artboards  ->  sync to Zeplin  ->  Restore
//
// Undo does NOT rely on the undo stack: the original string is stored on the layer
// itself via Settings.setLayerSettingForKey, so it survives closing and reopening.
//
// ============================ CODING RULES FOR THIS FILE ============================
// Sketch runs plugin command scripts through COSPreprocessor, which rewrites
// Objective-C message syntax into JavaScript. Because of that, a subscript may
// contain ONLY a single variable name or a number. Anything else must be assigned
// to a variable first.
//   WRONG: calling String directly inside a subscript to build an object key
//   RIGHT: var lid = String(l.id)  and then use lid as the key
// The rule also applies inside comments and string literals, because the
// preprocessor is regex based and does not skip them. That is why no example
// below is written with square brackets.
// Failures happen while the script is being LOADED, so no handler runs and no
// message appears at all. The only place the error shows up:
//   ~/Library/Logs/com.bohemiancoding.sketch3/Plugin Log.log
//
// Settings written with setLayerSettingForKey are scoped to the CALLING plugin.
// Code run through the MCP console runs as a different, temporary plugin and
// cannot read what this plugin wrote. Always drive Bake and Restore from the menu.
// ====================================================================================

var sketch = require('sketch')
var Settings = require('sketch/settings')

var KEY = 'citicsAllCapsOrig'
var KEY_OV = 'citicsAllCapsOrigOverrides'
var KEY_BAKED = 'citicsAllCapsBakedBoards'
var SUFFIX = '_stringValue'

// Normalise to NFC before uppercasing, otherwise decomposed Vietnamese
// diacritics break apart.
function upperCase(s) {
  var str = String(s)
  if (str.normalize) {
    str = str.normalize('NFC')
  }
  return str.toUpperCase()
}

function isUpper(layer) {
  try {
    if (!layer) { return false }
    if (!layer.style) { return false }
    return layer.style.textTransform === 'uppercase'
  } catch (e) {
    return false
  }
}

function kidsOf(layer) {
  var k = layer.layers
  if (!k) { return [] }
  return k
}

function scopes(doc, wholeDoc) {
  if (wholeDoc) { return doc.pages }
  // Do not build an array literal holding doc.selectedPage: COSPreprocessor reads
  // that as Objective-C message syntax and turns it into a function call.
  var one = []
  one.push(doc.selectedPage)
  return one
}

// Walk up to the frame that sits directly on the page (artboard or root frame).
function canvasBoardOf(layer) {
  var n = layer
  var guard = 0
  while (n && guard < 200) {
    var p = n.parent
    if (!p) { return null }
    if (p.type === 'Page') { return n }
    n = p
    guard = guard + 1
  }
  return null
}

// Ids of every text layer with uppercase turned on, including layers inside
// symbol masters and library symbols. Used to recognise which overrides belong
// to an uppercase layer WITHOUT touching o.affectedLayer, which is far too slow:
// reading it across 6000 instances freezes Sketch.
function upperTextIds(doc) {
  var ids = {}
  function walk(l) {
    if (l.type === 'Text') {
      if (isUpper(l)) {
        // Assign first. See the coding rules at the top of this file.
        var lid = String(l.id)
        ids[lid] = true
      }
    }
    var kids = kidsOf(l)
    var i
    for (i = 0; i < kids.length; i++) { walk(kids[i]) }
  }
  var pages = doc.pages
  var pi
  for (pi = 0; pi < pages.length; pi++) {
    var top = kidsOf(pages[pi])
    var ti
    for (ti = 0; ti < top.length; ti++) { walk(top[ti]) }
  }
  try {
    var syms = doc.getSymbols()
    var si
    for (si = 0; si < syms.length; si++) {
      var sl = kidsOf(syms[si])
      var xi
      for (xi = 0; xi < sl.length; xi++) { walk(sl[xi]) }
    }
  } catch (e) {}
  return ids
}

// An override id looks like  masterId / nestedId ... _stringValue
// so the text layer id is the last path segment.
function overrideTextId(o) {
  var id = String(o.id)
  var tail = id.slice(-SUFFIX.length)
  if (tail !== SUFFIX) { return null }
  var base = id.slice(0, id.length - SUFFIX.length)
  var parts = base.split('/')
  var lastIndex = parts.length - 1
  return parts[lastIndex]
}

function textsIn(page) {
  return sketch.find('Text', page)
}

function instancesIn(page) {
  return sketch.find('SymbolInstance', page)
}

// -------------------------------------------------- TRACK TOUCHED ARTBOARDS

function newTally() {
  return { order: [], byPage: {} }
}

function tallyBoard(tally, page, layer) {
  var board = canvasBoardOf(layer)
  if (!board) { return }
  var pid = String(page.id)
  var entry = tally.byPage[pid]
  if (!entry) {
    entry = { id: pid, name: String(page.name), boards: [], seen: {} }
    tally.byPage[pid] = entry
    tally.order.push(pid)
  }
  var bid = String(board.id)
  var already = entry.seen[bid]
  if (already) { return }
  entry.seen[bid] = true
  entry.boards.push(bid)
}

function tallyToStore(tally) {
  var pagesOut = []
  var i
  for (i = 0; i < tally.order.length; i++) {
    var pid = tally.order[i]
    var e = tally.byPage[pid]
    var slim = { id: e.id, name: e.name, boards: e.boards }
    pagesOut.push(slim)
  }
  return { pages: pagesOut }
}

function countBoards(store) {
  var total = 0
  var i
  for (i = 0; i < store.pages.length; i++) {
    var e = store.pages[i]
    total = total + e.boards.length
  }
  return total
}

// ---------------------------------------------------------------- COUNT

function count(wholeDoc) {
  var doc = sketch.getSelectedDocument()
  if (!doc) { return }
  var upperIds = upperTextIds(doc)
  var pages = scopes(doc, wholeDoc)
  var nText = 0
  var nOv = 0
  var pi
  for (pi = 0; pi < pages.length; pi++) {
    var texts = textsIn(pages[pi])
    var i
    for (i = 0; i < texts.length; i++) {
      if (isUpper(texts[i])) { nText = nText + 1 }
    }
    var insts = instancesIn(pages[pi])
    var j
    for (j = 0; j < insts.length; j++) {
      var ovs = insts[j].overrides
      var k
      for (k = 0; k < ovs.length; k++) {
        var o = ovs[k]
        if (o.property !== 'stringValue') { continue }
        if (o.isDefault) { continue }
        var tid = overrideTextId(o)
        if (tid && upperIds[tid]) { nOv = nOv + 1 }
      }
    }
  }
  var scopeLabel = wholeDoc ? 'whole file' : 'this page'
  sketch.UI.message('ALLCAPS in ' + scopeLabel + ': ' + nText + ' layers, ' + nOv + ' overrides')
}

// ----------------------------------------------------------------- BAKE

function bake(wholeDoc) {
  var doc = sketch.getSelectedDocument()
  if (!doc) { return }
  var upperIds = upperTextIds(doc)
  var pages = scopes(doc, wholeDoc)
  var tally = newTally()
  var nOv = 0
  var nText = 0
  var pi

  // Step 1, overrides FIRST. After step 2 the transform is off and there is no
  // way left to tell which layers used to be uppercase.
  for (pi = 0; pi < pages.length; pi++) {
    var page1 = pages[pi]
    var insts = instancesIn(page1)
    var j
    for (j = 0; j < insts.length; j++) {
      var inst = insts[j]
      var saved = {}
      var touched = false
      var ovs = inst.overrides
      var k
      for (k = 0; k < ovs.length; k++) {
        var o = ovs[k]
        if (o.property !== 'stringValue') { continue }
        if (o.isDefault) { continue }
        var tid = overrideTextId(o)
        if (!tid) { continue }
        if (!upperIds[tid]) { continue }
        var ovOrig = o.value
        if (ovOrig === null || ovOrig === undefined) { ovOrig = '' }
        ovOrig = String(ovOrig)
        var ovKey = String(o.id)
        saved[ovKey] = ovOrig
        o.value = upperCase(ovOrig)
        touched = true
        nOv = nOv + 1
      }
      if (touched) {
        Settings.setLayerSettingForKey(inst, KEY_OV, saved)
        tallyBoard(tally, page1, inst)
      }
    }
  }

  // Step 2, text layers. Baking the whole file also covers symbol masters,
  // because the Symbols page is part of doc.pages.
  for (pi = 0; pi < pages.length; pi++) {
    var page2 = pages[pi]
    var texts = textsIn(page2)
    var i
    for (i = 0; i < texts.length; i++) {
      var l = texts[i]
      if (!isUpper(l)) { continue }
      var orig = l.text
      Settings.setLayerSettingForKey(l, KEY, orig)
      l.text = upperCase(orig)
      l.style.textTransform = 'none'
      tallyBoard(tally, page2, l)
      nText = nText + 1
    }
  }

  var store = tallyToStore(tally)
  Settings.setDocumentSettingForKey(doc, KEY_BAKED, store)
  var nBoards = countBoards(store)
  var nPages = store.pages.length
  sketch.UI.message('Baked ' + nText + ' layers and ' + nOv + ' overrides across ' + nBoards + ' artboards on ' + nPages + ' pages. Run Select baked artboards, then sync to Zeplin.')
}

// ------------------------------------------- SELECT BAKED ARTBOARDS TO SYNC

function entryForPage(store, pageId) {
  var i
  for (i = 0; i < store.pages.length; i++) {
    var e = store.pages[i]
    if (String(e.id) === String(pageId)) { return e }
  }
  return null
}

function pageById(doc, pageId) {
  var pages = doc.pages
  var i
  for (i = 0; i < pages.length; i++) {
    var p = pages[i]
    if (String(p.id) === String(pageId)) { return p }
  }
  return null
}

function selectOnCurrentPage(doc, store) {
  var page = doc.selectedPage
  var curId = String(page.id)
  var entry = entryForPage(store, curId)
  if (!entry) { return -1 }
  doc.selectedLayers.clear()
  var n = 0
  var i
  for (i = 0; i < entry.boards.length; i++) {
    var wanted = entry.boards[i]
    var query = '#' + wanted
    var found = sketch.find(query, page)
    if (found.length > 0) {
      var lay = found[0]
      lay.selected = true
      n = n + 1
    }
  }
  return n
}

function otherPagesLeft(doc, store) {
  var curId = String(doc.selectedPage.id)
  var names = []
  var i
  for (i = 0; i < store.pages.length; i++) {
    var e = store.pages[i]
    if (String(e.id) !== curId) { names.push(e.name) }
  }
  return names
}

function readStore(doc) {
  var store = Settings.documentSettingForKey(doc, KEY_BAKED)
  if (!store) { return null }
  if (!store.pages) { return null }
  if (store.pages.length === 0) { return null }
  return store
}

function selectBaked() {
  var doc = sketch.getSelectedDocument()
  if (!doc) { return }
  var store = readStore(doc)
  if (!store) {
    sketch.UI.message('Nothing baked yet. Run Bake first.')
    return
  }
  var n = selectOnCurrentPage(doc, store)
  if (n < 0) {
    var left0 = otherPagesLeft(doc, store)
    sketch.UI.message('No baked artboards on this page. Pages with baked artboards: ' + left0.join(' | '))
    return
  }
  var left = otherPagesLeft(doc, store)
  var tail = ''
  if (left.length > 0) {
    tail = ' ' + left.length + ' more pages to go: ' + left.join(' | ')
  }
  sketch.UI.message('Selected ' + n + ' artboards on this page. Sync to Zeplin now.' + tail)
}

function selectBakedNextPage() {
  var doc = sketch.getSelectedDocument()
  if (!doc) { return }
  var store = readStore(doc)
  if (!store) {
    sketch.UI.message('Nothing baked yet. Run Bake first.')
    return
  }
  var curId = String(doc.selectedPage.id)
  var curIndex = -1
  var i
  for (i = 0; i < store.pages.length; i++) {
    var e = store.pages[i]
    if (String(e.id) === curId) { curIndex = i }
  }
  var nextIndex = curIndex + 1
  if (nextIndex >= store.pages.length) { nextIndex = 0 }
  var target = store.pages[nextIndex]
  var pg = pageById(doc, target.id)
  if (!pg) {
    sketch.UI.message('Page ' + target.name + ' no longer exists.')
    return
  }
  doc.selectedPage = pg
  var n = selectOnCurrentPage(doc, store)
  var pos = nextIndex + 1
  sketch.UI.message('Page ' + pos + ' of ' + store.pages.length + ', ' + target.name + ': selected ' + n + ' artboards.')
}

// -------------------------------------------------------------- RESTORE

function restore(wholeDoc) {
  var doc = sketch.getSelectedDocument()
  if (!doc) { return }
  var pages = scopes(doc, wholeDoc)
  var nText = 0
  var nOv = 0
  var pi

  for (pi = 0; pi < pages.length; pi++) {
    var texts = textsIn(pages[pi])
    var i
    for (i = 0; i < texts.length; i++) {
      var l = texts[i]
      var orig = Settings.layerSettingForKey(l, KEY)
      if (orig === undefined || orig === null) { continue }
      l.text = orig
      l.style.textTransform = 'uppercase'
      Settings.setLayerSettingForKey(l, KEY, undefined)
      nText = nText + 1
    }
  }

  for (pi = 0; pi < pages.length; pi++) {
    var insts = instancesIn(pages[pi])
    var j
    for (j = 0; j < insts.length; j++) {
      var inst = insts[j]
      var saved = Settings.layerSettingForKey(inst, KEY_OV)
      if (!saved) { continue }
      var ovs = inst.overrides
      var k
      for (k = 0; k < ovs.length; k++) {
        var o = ovs[k]
        var backKey = String(o.id)
        var back = saved[backKey]
        if (back === undefined) { continue }
        o.value = back
        nOv = nOv + 1
      }
      Settings.setLayerSettingForKey(inst, KEY_OV, undefined)
    }
  }

  if (wholeDoc) {
    Settings.setDocumentSettingForKey(doc, KEY_BAKED, undefined)
  }
  sketch.UI.message('Restored ' + nText + ' layers and ' + nOv + ' overrides to their original casing.')
}

// ------------------------------------------------------------- HANDLERS

function onCountPage() { count(false) }
function onCountDoc() { count(true) }
function onBakePage() { bake(false) }
function onBakeDoc() { bake(true) }
function onSelectBaked() { selectBaked() }
function onSelectBakedNext() { selectBakedNextPage() }
function onRestorePage() { restore(false) }
function onRestoreDoc() { restore(true) }

// Legacy handler names, kept in case Sketch still holds an older manifest.
function onCount() { count(false) }
function onBake() { bake(false) }
function onRestore() { restore(false) }

module.exports = {
  onCountPage: onCountPage,
  onCountDoc: onCountDoc,
  onBakePage: onBakePage,
  onBakeDoc: onBakeDoc,
  onSelectBaked: onSelectBaked,
  onSelectBakedNext: onSelectBakedNext,
  onRestorePage: onRestorePage,
  onRestoreDoc: onRestoreDoc,
  onCount: onCount,
  onBake: onBake,
  onRestore: onRestore
}
