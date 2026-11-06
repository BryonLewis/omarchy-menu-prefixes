// Unit tests for PrefixModel.js — run with: node --test tests/

const test = require("node:test")
const assert = require("node:assert")

const PrefixModel = require("../PrefixModel.js")

function tableFor(config) {
  return PrefixModel.normalizeTable(PrefixModel.mergeConfig(PrefixModel.defaultConfig(), config))
}

test("defaults include file:, g:, yt:, =, !", () => {
  const table = tableFor(null)
  const prefixes = table.map((e) => e.prefix)
  assert.ok(prefixes.includes("file:"))
  assert.ok(prefixes.includes("g:"))
  assert.ok(prefixes.includes("yt:"))
  assert.ok(prefixes.includes("="))
  assert.ok(prefixes.includes("!"))
})

test("defaults use theme icons for g: and yt:", () => {
  const table = tableFor(null)
  const g = table.find((e) => e.prefix === "g:")
  const yt = table.find((e) => e.prefix === "yt:")
  assert.equal(g.appIcon, "google-chrome")
  assert.equal(g.fontIcon, "")
  assert.equal(yt.appIcon, "youtube")
  assert.equal(yt.fontIcon, "")
})

test("table is sorted longest prefix first", () => {
  const table = PrefixModel.normalizeTable({
    prefixes: { "g:": { kind: "web", url: "https://x/?q={query}" }, "gh:": { kind: "web", url: "https://y/?q={query}" } }
  })
  assert.equal(table[0].prefix, "gh:")
})

test("resolvePrefix matches and extracts the query", () => {
  const table = tableFor(null)
  const match = PrefixModel.resolvePrefix("g:data pipelines", table)
  assert.equal(match.prefix, "g:")
  assert.equal(match.kind, "web")
  assert.equal(match.query, "data pipelines")
})

test("resolvePrefix picks the longest matching prefix", () => {
  const table = tableFor({ prefixes: { "gh:": { kind: "web", label: "GitHub", url: "https://github.com/search?q={query}" } } })
  const match = PrefixModel.resolvePrefix("gh:omarchy", table)
  assert.equal(match.prefix, "gh:")
  assert.equal(match.query, "omarchy")
})

test("resolvePrefix returns null on no match, empty remainder, or blank remainder", () => {
  const table = tableFor(null)
  assert.equal(PrefixModel.resolvePrefix("firefox", table), null)
  assert.equal(PrefixModel.resolvePrefix("g:", table), null)
  assert.equal(PrefixModel.resolvePrefix("g:   ", table), null)
  assert.equal(PrefixModel.resolvePrefix("", table), null)
})

test("file prefix matches file: queries", () => {
  const table = tableFor(null)
  const match = PrefixModel.resolvePrefix("file:bashrc", table)
  assert.equal(match.kind, "file")
  assert.equal(match.query, "bashrc")
  assert.equal(match.entry.maxResults, 60)
  assert.equal(match.entry.caseInsensitive, true)
})

test("user config overrides defaults per key", () => {
  const table = tableFor({ prefixes: { "g:": { fontIcon: "X" } } })
  const g = table.find((e) => e.prefix === "g:")
  assert.equal(g.fontIcon, "X")
  assert.equal(g.label, "Google") // default survives
  assert.equal(g.url, "https://www.google.com/search?q={query}")
})

test("legacy icon key maps to fontIcon", () => {
  const table = tableFor({ prefixes: { "g:": { icon: "legacy" } } })
  const g = table.find((e) => e.prefix === "g:")
  assert.equal(g.fontIcon, "legacy")
})

test("appIcon is normalized alongside fontIcon", () => {
  const table = tableFor({
    prefixes: {
      "g:": { appIcon: "google-chrome", fontIcon: "" },
      "yt:": { appIcon: "youtube" }
    }
  })
  const g = table.find((e) => e.prefix === "g:")
  const yt = table.find((e) => e.prefix === "yt:")
  assert.equal(g.appIcon, "google-chrome")
  assert.equal(g.fontIcon, "")
  assert.equal(yt.appIcon, "youtube")
  assert.equal(yt.fontIcon, "")
})

test("null prefix entry removes the default", () => {
  const table = tableFor({ prefixes: { "g:": null } })
  assert.equal(table.find((e) => e.prefix === "g:"), undefined)
})

test("user can add custom prefixes of every kind", () => {
  const table = tableFor({
    file: { prefix: "f:" },
    prefixes: {
      "gh:": { kind: "web", label: "GitHub", url: "https://github.com/search?q={query}" },
      "t:": { kind: "cmd", label: "Terminal", cmd: "foot -- {query}" }
    }
  })
  assert.equal(table.find((e) => e.prefix === "f:").kind, "file")
  assert.equal(table.find((e) => e.prefix === "file:"), undefined)
  assert.equal(table.find((e) => e.prefix === "gh:").kind, "web")
  assert.equal(table.find((e) => e.prefix === "t:").kind, "cmd")
})

test("file search can be disabled with an empty prefix", () => {
  const table = tableFor({ file: { prefix: "" } })
  assert.equal(table.find((e) => e.kind === "file"), undefined)
})

test("invalid entries are dropped without breaking the rest", () => {
  const table = PrefixModel.normalizeTable({
    prefixes: {
      "a:": { kind: "web" }, // web without url
      "b:": { kind: "cmd" }, // cmd without cmd
      "c:": { kind: "bogus" }, // unknown kind
      "d:": "not an object",
      "e:": { kind: "web", url: "https://e/?q={query}" }
    }
  })
  const prefixes = table.map((e) => e.prefix)
  assert.deepEqual(prefixes, ["e:"])
})

test("parseConfig accepts JSONC with comments and trailing commas", () => {
  const parsed = PrefixModel.parseConfig('{\n  // comment\n  "prefixes": { "g:": null, },\n}')
  assert.deepEqual(parsed, { prefixes: { "g:": null } })
})

test("parseConfig returns null for empty or invalid input", () => {
  assert.equal(PrefixModel.parseConfig(""), null)
  assert.equal(PrefixModel.parseConfig("   "), null)
  assert.equal(PrefixModel.parseConfig("{ nope"), null)
  assert.equal(PrefixModel.parseConfig("[1,2]"), null)
})

test("expandUrl URL-encodes the query once", () => {
  assert.equal(
    PrefixModel.expandUrl("https://x/search?q={query}", "hello world & more"),
    "https://x/search?q=hello%20world%20%26%20more"
  )
})

test("expandCommand quotes {query} and passes {raw} verbatim", () => {
  assert.equal(PrefixModel.expandCommand("foot -- {query}", "ls -la"), "foot -- 'ls -la'")
  assert.equal(PrefixModel.expandCommand("echo {raw}", "ls -la"), "echo ls -la")
  assert.equal(PrefixModel.expandCommand("{query} && {raw}", "x"), "'x' && x")
})

test("expandCommand escapes embedded single quotes", () => {
  assert.equal(PrefixModel.expandCommand("echo {query}", "it's"), "echo 'it'\\''s'")
})

test("expandCommand does not re-expand placeholders inside the query", () => {
  assert.equal(PrefixModel.expandCommand("echo {query} {raw}", "{raw}"), "echo '{raw}' {raw}")
})

test("expandCommand {urlquery} URL-encodes and shell-quotes", () => {
  assert.equal(
    PrefixModel.expandCommand("xdg-open 'app://s?q='{urlquery}", "a b&c"),
    "xdg-open 'app://s?q=''a%20b%26c'"
  )
})

// {urlquery} exists so a URI-building command never has to splice the input
// into quotes it wrote itself. Neither a quote nor a shell metacharacter may
// survive into the expansion.
test("expandCommand {urlquery} cannot break out of a quoted URI", () => {
  const expanded = PrefixModel.expandCommand(
    "xdg-open 'obsidian://search?vault=P&query='{urlquery}",
    "x\"; touch /tmp/pwned; \"y"
  )
  assert.equal(expanded, "xdg-open 'obsidian://search?vault=P&query=''x%22%3B%20touch%20%2Ftmp%2Fpwned%3B%20%22y'")
  assert.ok(!/[";]/.test(expanded.slice("xdg-open 'obsidian://search?vault=P&query='".length)))
})

test("formatRowLabel defaults for web and cmd", () => {
  assert.equal(
    PrefixModel.formatRowLabel("web", { label: "Google" }, "g:", "hyprland"),
    'Search Google for "hyprland"'
  )
  assert.equal(
    PrefixModel.formatRowLabel("cmd", { label: "Obsidian" }, "ob:", "weather"),
    "Run Obsidian"
  )
  assert.equal(
    PrefixModel.formatRowLabel("cmd", {}, "run:", "fastfetch"),
    "Run command"
  )
})

test("formatRowLabel uses rowLabel template when set", () => {
  const entry = { label: "Obsidian", rowLabel: 'Search {label} for "{query}"' }
  assert.equal(
    PrefixModel.formatRowLabel("cmd", entry, "ob:", "weather"),
    'Search Obsidian for "weather"'
  )
  assert.equal(
    PrefixModel.expandRowLabel("Open {prefix} vault: {query}", { label: "Obsidian", query: "x", prefix: "ob:" }),
    "Open ob: vault: x"
  )
})

test("normalizeTable preserves rowLabel", () => {
  const table = tableFor({
    prefixes: {
      "ob:": { kind: "cmd", label: "Obsidian", rowLabel: "Find in {label}", cmd: "echo {query}" }
    }
  })
  assert.equal(table.find((e) => e.prefix === "ob:").rowLabel, "Find in {label}")
})

test("normalizeTable preserves cmd renderResults flag", () => {
  const table = tableFor({
    prefixes: {
      "e:": { kind: "cmd", label: "Echo", cmd: "echo {query}", renderResults: true },
      "l:": { kind: "cmd", label: "Echo", cmd: "echo {query}", render: true },
      "r:": { kind: "cmd", label: "Run", cmd: "echo {query}" }
    }
  })
  assert.equal(table.find((e) => e.prefix === "e:").renderResults, true)
  assert.equal(table.find((e) => e.prefix === "l:").renderResults, true)
  assert.equal(table.find((e) => e.prefix === "r:").renderResults, false)
})

test("normalizeTable preserves cmd renderTimeout", () => {
  const table = tableFor({
    prefixes: {
      "ha:": { kind: "cmd", label: "HA", cmd: "echo {query}", renderResults: true, renderTimeout: 45 },
      "e:": { kind: "cmd", label: "Echo", cmd: "echo {query}", renderResults: true }
    }
  })
  assert.equal(table.find((e) => e.prefix === "ha:").renderTimeout, 45)
  assert.equal(table.find((e) => e.prefix === "e:").renderTimeout, 5)
})

test("normalizeTable preserves cmd renderOnEnter", () => {
  const table = tableFor({
    prefixes: {
      "ha:": { kind: "cmd", label: "HA", cmd: "echo {query}", renderResults: true, renderOnEnter: true },
      "e:": { kind: "cmd", label: "Echo", cmd: "echo {query}", renderResults: true, renderOnEnter: false },
      "c:": { kind: "cmd", label: "Calc", cmd: "echo {query}", renderResults: true }
    }
  })
  assert.equal(table.find((e) => e.prefix === "ha:").renderOnEnter, true)
  assert.equal(table.find((e) => e.prefix === "e:").renderOnEnter, false)
  assert.equal(table.find((e) => e.prefix === "c:").renderOnEnter, true)
})

test("formatCmdRenderOutput preserves full text and newlines", () => {
  assert.deepEqual(PrefixModel.formatCmdRenderOutput("  hello\nworld  "), {
    full: "hello\nworld",
    label: "hello"
  })
  assert.equal(PrefixModel.formatCmdRenderOutput(""), null)
  assert.equal(PrefixModel.formatCmdRenderOutput("   \n"), null)

  const long = "x".repeat(900)
  const formatted = PrefixModel.formatCmdRenderOutput(long)
  assert.ok(formatted)
  assert.equal(formatted.full.length, 900)
  assert.equal(formatted.label.length, 900)
})

test("formatRowLabel falls back to merged prefixes when entry lacks rowLabel", () => {
  const merged = PrefixModel.mergeConfig(PrefixModel.defaultConfig(), {
    prefixes: {
      "ob:": { kind: "cmd", label: "Obsidian", rowLabel: 'Search {label} for "{query}"', cmd: "echo {query}" }
    }
  })
  const entry = { prefix: "ob:", kind: "cmd", label: "Obsidian", cmd: "echo {query}" }
  assert.equal(
    PrefixModel.formatRowLabel("cmd", entry, "ob:", "weather", merged.prefixes),
    'Search Obsidian for "weather"'
  )
})

test("evaluateCalc computes expressions and functions", () => {
  assert.equal(PrefixModel.evaluateCalc("4*23"), 92)
  assert.equal(PrefixModel.evaluateCalc("sqrt(16)"), 4)
  assert.equal(PrefixModel.evaluateCalc("pow(2,10)+round(pi)"), 1027)
  assert.equal(PrefixModel.evaluateCalc("2^10"), 1024)
  assert.equal(PrefixModel.evaluateCalc("2**10"), 1024)
  assert.equal(PrefixModel.evaluateCalc("10%3"), 1)
  assert.equal(PrefixModel.evaluateCalc(".5*4"), 2)
  assert.equal(PrefixModel.evaluateCalc("1e3"), 1000)
  assert.equal(PrefixModel.evaluateCalc("MAX(1,2)"), 2) // case-insensitive
  assert.equal(PrefixModel.evaluateCalc("hypot(3,4)"), 5)
  assert.equal(PrefixModel.evaluateCalc("0.1+0.2"), 0.3) // float tail trimmed
})

test("evaluateCalc uses mathematical precedence for ^", () => {
  assert.equal(PrefixModel.evaluateCalc("-2^2"), -4)  // not (-2)^2
  assert.equal(PrefixModel.evaluateCalc("2^3^2"), 512) // right-associative
  assert.equal(PrefixModel.evaluateCalc("2^-1"), 0.5)
})

test("evaluateCalc rejects anything that is not arithmetic", () => {
  assert.equal(PrefixModel.evaluateCalc("process.exit(1)"), null)
  assert.equal(PrefixModel.evaluateCalc("while(true){}"), null)
  assert.equal(PrefixModel.evaluateCalc("constructor"), null)
  assert.equal(PrefixModel.evaluateCalc(""), null)
  assert.equal(PrefixModel.evaluateCalc("this"), null)
  assert.equal(PrefixModel.evaluateCalc("globalThis"), null)
  assert.equal(PrefixModel.evaluateCalc("Math.pow(2,3)"), null)
  assert.equal(PrefixModel.evaluateCalc("(function(){})()"), null)
  assert.equal(PrefixModel.evaluateCalc("1&&2"), null)
  assert.equal(PrefixModel.evaluateCalc("1?2:3"), null)
  assert.equal(PrefixModel.evaluateCalc("[1]"), null)
  assert.equal(PrefixModel.evaluateCalc("0x10"), null)
})

// A plain `name in CALC_FUNCTIONS` test would answer true for both of these
// out of Object.prototype, letting them past the allowlist.
test("evaluateCalc rejects inherited property names", () => {
  assert.equal(PrefixModel.evaluateCalc("constructor(1)"), null)
  assert.equal(PrefixModel.evaluateCalc("__proto__"), null)
  assert.equal(PrefixModel.evaluateCalc("__proto__(1)"), null)
  assert.equal(PrefixModel.evaluateCalc("hasOwnProperty(1)"), null)
  assert.equal(PrefixModel.evaluateCalc("valueOf"), null)
})

test("evaluateCalc enforces function arity", () => {
  assert.equal(PrefixModel.evaluateCalc("pow(2)"), null)
  assert.equal(PrefixModel.evaluateCalc("pow(2,3,4)"), null)
  assert.equal(PrefixModel.evaluateCalc("sqrt()"), null)
  assert.equal(PrefixModel.evaluateCalc("min()"), null)
})

test("evaluateCalc rejects malformed expressions instead of throwing", () => {
  for (const expr of ["1+", "(1", "1)", "1,2", "1..2", "1.2.3", "2e", "pi.e", "e(1)", "4 4"]) {
    assert.equal(PrefixModel.evaluateCalc(expr), null, expr)
  }
})

test("evaluateCalc rejects non-finite results", () => {
  assert.equal(PrefixModel.evaluateCalc("100/0"), null)
  assert.equal(PrefixModel.evaluateCalc("0/0"), null)
  assert.equal(PrefixModel.evaluateCalc("1e999"), null)
  assert.equal(PrefixModel.evaluateCalc("1e300*1e300"), null)
})

// Both caps exist so a pasted filter cannot make the calculator do unbounded
// work or recurse the parser deep enough to exhaust the stack.
test("evaluateCalc caps input length and nesting depth", () => {
  assert.equal(PrefixModel.evaluateCalc("1+".repeat(200) + "1"), null)
  assert.equal(PrefixModel.evaluateCalc("(".repeat(400) + "1" + ")".repeat(400)), null)
  assert.equal(PrefixModel.evaluateCalc("(".repeat(20) + "1" + ")".repeat(20)), 1)
})

test("tokenizeCalc rejects characters with no arithmetic meaning", () => {
  assert.equal(PrefixModel.tokenizeCalc("1;2"), null)
  assert.equal(PrefixModel.tokenizeCalc("1|2"), null)
  assert.equal(PrefixModel.tokenizeCalc("`x`"), null)
  assert.equal(PrefixModel.tokenizeCalc("$(x)"), null)
  assert.ok(Array.isArray(PrefixModel.tokenizeCalc("1+2")))
})

test("parseCurrencyQuery handles codes, symbols, and either position", () => {
  assert.deepEqual(PrefixModel.parseCurrencyQuery("420 usd to dkk"), { amount: 420, from: "USD", to: "DKK" })
  assert.deepEqual(PrefixModel.parseCurrencyQuery("usd 420 to dkk"), { amount: 420, from: "USD", to: "DKK" })
  assert.deepEqual(PrefixModel.parseCurrencyQuery("$420 to dkk"), { amount: 420, from: "USD", to: "DKK" })
  assert.deepEqual(PrefixModel.parseCurrencyQuery("420$ to dkk"), { amount: 420, from: "USD", to: "DKK" })
  assert.deepEqual(PrefixModel.parseCurrencyQuery("420,50 EUR to GBP"), { amount: 420.5, from: "EUR", to: "GBP" })
  assert.equal(PrefixModel.parseCurrencyQuery("420 usd"), null)
  assert.equal(PrefixModel.parseCurrencyQuery("420 to dkk"), null) // no source currency
})

test("parseCurrencyRateResponse computes rate conversion and handles errors", () => {
  const parsed = { amount: 420, from: "USD", to: "AOA" }
  const rawResponse = JSON.stringify({ date: "2026-08-28", base: "USD", quote: "AOA", rate: 920.51 })
  assert.deepEqual(PrefixModel.parseCurrencyRateResponse(rawResponse, parsed), {
    amount: 420,
    from: "USD",
    to: "AOA",
    converted: 420 * 920.51,
    rate: 920.51
  })

  // Invalid responses
  assert.equal(PrefixModel.parseCurrencyRateResponse("invalid json", parsed), null)
  assert.equal(PrefixModel.parseCurrencyRateResponse(JSON.stringify({ status: 422, message: "invalid currency" }), parsed), null)
  assert.equal(PrefixModel.parseCurrencyRateResponse(JSON.stringify({ rate: "not a number" }), parsed), null)
  assert.equal(PrefixModel.parseCurrencyRateResponse(rawResponse, null), null)
  assert.equal(PrefixModel.parseCurrencyRateResponse(JSON.stringify({ base: "EUR", quote: "AOA", rate: 920.51 }), parsed), null)
  assert.equal(PrefixModel.parseCurrencyRateResponse(JSON.stringify({ base: "USD", quote: "EUR", rate: 920.51 }), parsed), null)
})

test("mergeConfig keeps defaults for a missing file section", () => {
  const merged = PrefixModel.mergeConfig(PrefixModel.defaultConfig(), { prefixes: { "w:": { kind: "web", url: "https://w/?q={query}" } } })
  assert.equal(merged.file.prefix, "file:")
  assert.equal(merged.prefixes["g:"].url, "https://www.google.com/search?q={query}")
})
