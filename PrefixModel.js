// Prefix search modes for omarchy-menu-prefixes.
//
// Pure JS with no QML dependencies so the config parsing, prefix resolution,
// and template expansion logic can be unit-tested with plain `node` (see
// tests/prefixes.test.js). Menu.qml imports this the same way it imports
// MenuModel.js.

// JSONC stripping identical to MenuModel.js (duplicated rather than imported
// so this file stays loadable by plain node).
function stripJsonc(raw) {
  return String(raw || "")
    .replace(/^\s*\/\/[^\n]*(\n|$)/gm, "")
    .replace(/,(\s*[}\]])/g, "$1")
}

// Single-quote a string for bash, matching Util.shellQuote in the shell.
function shellQuote(value) {
  return "'" + String(value || "").replace(/'/g, "'\\''") + "'"
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function clampInt(value, min, max, fallback) {
  var parsed = parseInt(value, 10)
  if (!isFinite(parsed)) parsed = fallback
  return Math.min(max, Math.max(min, parsed))
}

// Kinds a prefix entry may declare. `file` comes from the dedicated `file`
// config section; the rest live in the `prefixes` map.
var VALID_KINDS = ["file", "web", "cmd", "calc", "currency"]

// Baked-in defaults, used verbatim when no user config exists and as the
// base the user config overlays. Icons are Nerd Font glyphs (BMP codepoints
// so they can be written as \uXXXX escapes in both JS and JSONC).
function defaultConfig() {
  return {
    file: {
      prefix: "file:",
      label: "Files",
      icon: "\uf15b",
      maxResults: 60,
      caseInsensitive: true
    },
    prefixes: {
      "g:": {
        kind: "web",
        label: "Google",
        icon: "\uf1a0",
        url: "https://www.google.com/search?q={query}"
      },
      "yt:": {
        kind: "web",
        label: "YouTube",
        icon: "\uf167",
        url: "https://www.youtube.com/results?search_query={query}"
      },
      "=": { kind: "calc", label: "Calculator", icon: "\uf1ec" },
      "!": { kind: "currency", label: "Currency", icon: "\uf155" }
    }
  }
}

// Parse a JSONC config body. Returns the parsed object, or null when empty
// or invalid (caller falls back to defaults).
function parseConfig(raw) {
  var stripped = stripJsonc(raw)
  if (!stripped.trim()) return null
  var parsed
  try {
    parsed = JSON.parse(stripped)
  } catch (e) {
    return null
  }
  return isPlainObject(parsed) ? parsed : null
}

// Per-key merge of one config entry. An overlay key always wins; keys only
// present in the base survive (so a user can tweak just the icon of `g:`).
function mergeEntry(base, overlay) {
  var out = ({})
  if (isPlainObject(base)) {
    for (var k in base) out[k] = base[k]
  }
  if (isPlainObject(overlay)) {
    for (var k2 in overlay) out[k2] = overlay[k2]
  }
  return out
}

// Merge a user config over the defaults. The `file` section merges per-key;
// each `prefixes` entry merges per-key, and an explicit null removes that
// prefix entirely.
function mergeConfig(defaults, user) {
  var base = defaults || defaultConfig()
  var overlay = user || ({})

  var prefixes = ({})
  var basePrefixes = isPlainObject(base.prefixes) ? base.prefixes : ({})
  var overlayPrefixes = isPlainObject(overlay.prefixes) ? overlay.prefixes : ({})

  var keys = Object.keys(basePrefixes)
  for (var i = 0; i < keys.length; i++) {
    if (overlayPrefixes[keys[i]] === null) continue // removed by the user
    prefixes[keys[i]] = mergeEntry(basePrefixes[keys[i]], overlayPrefixes[keys[i]])
  }

  var overlayKeys = Object.keys(overlayPrefixes)
  for (var j = 0; j < overlayKeys.length; j++) {
    var key = overlayKeys[j]
    if (prefixes[key] || overlayPrefixes[key] === null) continue
    prefixes[key] = mergeEntry(null, overlayPrefixes[key])
  }

  return {
    file: mergeEntry(base.file, overlay.file),
    prefixes: prefixes
  }
}

// Flatten a merged config into a match table: one record per prefix, sorted
// by descending prefix length so `gh:` wins over `g:` for "gh:omarchy".
// Invalid entries (unknown kind, web without url, cmd without cmd) are
// dropped rather than failing the whole config.
function normalizeTable(config) {
  var cfg = config || defaultConfig()
  var table = []
  var seen = ({})

  var fileCfg = isPlainObject(cfg.file) ? cfg.file : ({})
  var filePrefix = String(fileCfg.prefix || "")
  if (filePrefix) {
    seen[filePrefix] = true
    table.push({
      prefix: filePrefix,
      kind: "file",
      label: String(fileCfg.label || "Files"),
      icon: String(fileCfg.icon || ""),
      maxResults: clampInt(fileCfg.maxResults, 1, 500, 60),
      caseInsensitive: fileCfg.caseInsensitive !== false
    })
  }

  var prefixes = isPlainObject(cfg.prefixes) ? cfg.prefixes : ({})
  var keys = Object.keys(prefixes)
  for (var i = 0; i < keys.length; i++) {
    var prefix = String(keys[i] || "")
    var entry = prefixes[keys[i]]
    if (!prefix || seen[prefix]) continue
    if (!isPlainObject(entry)) continue
    var kind = String(entry.kind || "")
    if (VALID_KINDS.indexOf(kind) < 0) continue
    if (kind === "web" && !String(entry.url || "")) continue
    if (kind === "cmd" && !String(entry.cmd || "")) continue

    seen[prefix] = true
    table.push({
      prefix: prefix,
      kind: kind,
      label: String(entry.label || ""),
      icon: String(entry.icon || ""),
      url: String(entry.url || ""),
      cmd: String(entry.cmd || "")
    })
  }

  table.sort(function(a, b) { return b.prefix.length - a.prefix.length })
  return table
}

// Longest configured prefix that `text` starts with, leaving at least one
// non-blank character of query after it. Returns
// { prefix, kind, query, entry } or null when nothing matches.
function resolvePrefix(text, table) {
  var value = String(text || "")
  var entries = Array.isArray(table) ? table : []
  for (var i = 0; i < entries.length; i++) {
    var prefix = entries[i].prefix
    if (!prefix || value.length <= prefix.length) continue
    if (value.indexOf(prefix) !== 0) continue
    var query = value.substring(prefix.length).trim()
    if (!query) continue
    return {
      prefix: prefix,
      kind: entries[i].kind,
      query: query,
      entry: entries[i]
    }
  }
  return null
}

// ---------------------------------------------------------------- templates

// Web URL template: {query} becomes the URL-encoded search text. Replaced in
// a single pass so an encoded query can never re-enter the template.
function expandUrl(template, query) {
  var value = String(query || "")
  return String(template || "").replace(/\{query\}/g, function() {
    return encodeURIComponent(value)
  })
}

// Command template. Placeholders, replaced in one pass:
//   {query} -> the input, shell-quoted (passed to the command as ONE argument)
//   {raw}   -> the input, substituted verbatim (treated as shell code)
function expandCommand(template, query) {
  var value = String(query || "")
  return String(template || "").replace(/\{(query|raw)\}/g, function(match, name) {
    return name === "raw" ? value : shellQuote(value)
  })
}

// ------------------------------------------------------------- calculator

// Math functions/constants allowed in calc expressions, keyed by lowercase
// spelling (so "SQRT"/"Sqrt"/"sqrt" all work) mapping to the real Math.*
// member. Anything else is rejected before ever reaching Function() — this
// stays an arithmetic evaluator, not a general eval sink.
var CALC_FUNCTIONS = ({
  sqrt: "sqrt", cbrt: "cbrt", abs: "abs", pow: "pow", hypot: "hypot",
  sin: "sin", cos: "cos", tan: "tan", asin: "asin", acos: "acos", atan: "atan", atan2: "atan2",
  log: "log", log2: "log2", log10: "log10", exp: "exp",
  floor: "floor", ceil: "ceil", round: "round", trunc: "trunc", sign: "sign",
  min: "min", max: "max", pi: "PI", e: "E"
})

function evaluateCalc(expr) {
  var trimmed = String(expr || "").trim()
  if (!trimmed || /[^0-9a-zA-Z+\-*/%().,\s^]/.test(trimmed)) return null

  var identifiers = trimmed.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || []
  for (var i = 0; i < identifiers.length; i++) {
    if (!(identifiers[i].toLowerCase() in CALC_FUNCTIONS)) return null
  }

  var sanitized = trimmed.replace(/\^/g, "**")
  sanitized = sanitized.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, function(match) {
    return "Math." + CALC_FUNCTIONS[match.toLowerCase()]
  })

  try {
    var value = Function("return (" + sanitized + ")")()
    if (typeof value !== "number" || !isFinite(value)) return null
    return Math.round(value * 1e10) / 1e10
  } catch (e) {
    return null
  }
}

// --------------------------------------------------------------- currency

// "!" prefix: currency conversion (e.g. "!420 usd to dkk", "!$420 to dkk",
// "!420 to £"). Case-insensitive; recognizes a few common currency symbols
// in addition to 3-letter ISO codes, in either position.
var CURRENCY_SYMBOLS = ({
  "$": "USD", "£": "GBP", "€": "EUR", "¥": "JPY", "₹": "INR", "₩": "KRW"
})

// Swaps each known symbol for its ISO code with padding spaces, so
// "$420 to dkk" and "420$ to dkk" both normalize to word-separated form
// regardless of which side of the amount the symbol was on.
function normalizeCurrencyText(text) {
  var result = text
  for (var symbol in CURRENCY_SYMBOLS) {
    if (result.indexOf(symbol) === -1) continue
    result = result.split(symbol).join(" " + CURRENCY_SYMBOLS[symbol] + " ")
  }
  return result.replace(/\s+/g, " ").trim()
}

// Accepts the currency code either before or after the amount (covers both
// "usd 420 to dkk" and "420 usd to dkk", which the symbol normalization
// above can produce depending on where the symbol was typed).
function parseCurrencyQuery(text) {
  var normalized = normalizeCurrencyText(text)
  var match = normalized.match(/^(?:([a-zA-Z]{3})\s+(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s+([a-zA-Z]{3}))\s+to\s+([a-zA-Z]{3})$/i)
  if (!match) return null
  var fromCode = (match[1] || match[4] || "").toUpperCase()
  var amountStr = (match[2] || match[3] || "").replace(",", ".")
  var toCode = match[5].toUpperCase()
  var amount = parseFloat(amountStr)
  if (!fromCode || !toCode || !isFinite(amount)) return null
  return { amount: amount, from: fromCode, to: toCode }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    VALID_KINDS: VALID_KINDS,
    CALC_FUNCTIONS: CALC_FUNCTIONS,
    CURRENCY_SYMBOLS: CURRENCY_SYMBOLS,
    stripJsonc: stripJsonc,
    shellQuote: shellQuote,
    isPlainObject: isPlainObject,
    defaultConfig: defaultConfig,
    parseConfig: parseConfig,
    mergeEntry: mergeEntry,
    mergeConfig: mergeConfig,
    normalizeTable: normalizeTable,
    resolvePrefix: resolvePrefix,
    expandUrl: expandUrl,
    expandCommand: expandCommand,
    evaluateCalc: evaluateCalc,
    normalizeCurrencyText: normalizeCurrencyText,
    parseCurrencyQuery: parseCurrencyQuery
  }
}
