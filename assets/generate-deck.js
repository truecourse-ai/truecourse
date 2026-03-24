const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const {
  FaBolt, FaBug, FaClock, FaCogs, FaCode, FaLock,
  FaProjectDiagram, FaTerminal, FaArrowRight, FaCheckCircle,
  FaTimesCircle, FaChevronRight
} = require("react-icons/fa");
const fs = require("fs");

// ─── PALETTE ───
const BG_DARK    = "111111";
const BG_MID     = "1A1A1A";
const BG_CARD    = "1E1E1E";
const BG_CARD2   = "242424";
const ACCENT     = "3B82F6";
const ACCENT2    = "60A5FA";
const WHITE      = "FFFFFF";
const OFF_WHITE  = "E8E8E8";
const GRAY       = "888888";
const GRAY_LIGHT = "AAAAAA";
const GRAY_DIM   = "555555";
const BLUE       = "3B82F6";
const GREEN      = "34D399";
const W = 10, H = 5.625;
const HDR = "Arial Black", BODY = "Arial";

// ─── ICON HELPERS ───
function renderSvg(Comp, color, size = 256) {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(Comp, { color, size: String(size) })
  );
}
async function icon(Comp, color, size = 256) {
  const svg = renderSvg(Comp, color, size);
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}
const shadow = () => ({ type: "outer", blur: 10, offset: 3, angle: 145, color: "000000", opacity: 0.4 });

// ─── MAIN ───
async function buildDeck() {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";
  pres.author = "Mushegh Gevorgyan";
  pres.title = "TrueCourse — Pitch Deck";

  // Pre-render all icons
  const [icBolt, icBug, icClock, icCogs, icCode, icLock, icGraph, icTerm, icArrow, icCheck, icX, icChev] = await Promise.all([
    icon(FaBolt, "#" + ACCENT), icon(FaBug, "#" + ACCENT), icon(FaClock, "#" + ACCENT),
    icon(FaCogs, "#" + OFF_WHITE), icon(FaCode, "#" + OFF_WHITE), icon(FaLock, "#" + OFF_WHITE),
    icon(FaProjectDiagram, "#" + OFF_WHITE), icon(FaTerminal, "#" + OFF_WHITE),
    icon(FaArrowRight, "#" + ACCENT), icon(FaCheckCircle, "#" + ACCENT2),
    icon(FaTimesCircle, "#" + "EF4444"), icon(FaChevronRight, "#" + ACCENT),
  ]);

  // Logo (recolored for dark bg)
  const logoSvg = fs.readFileSync("/Users/musheghgevorgyan/repos/truecourse/assets/logo.svg", "utf-8");
  const logoWhite = logoSvg.replace(/fill="#1e3a5f"/g, 'fill="#e2e8f0"').replace(/stroke="#1e3a5f"/g, 'stroke="#e2e8f0"');
  const logoPng = "image/png;base64," + (await sharp(Buffer.from(logoWhite)).resize(400, 320).png().toBuffer()).toString("base64");
  const screenshotPath = "/Users/musheghgevorgyan/repos/truecourse/assets/screenshot.png";

  // ════════════════════════════════════════
  // SLIDE 1 — TITLE (cinematic, full-bleed)
  // ════════════════════════════════════════
  let s1 = pres.addSlide();
  s1.background = { color: BG_DARK };

  // Logo
  s1.addImage({ data: logoPng, x: 3.5, y: 0.35, w: 3.0, h: 2.4 });

  // Tagline — large, bold
  s1.addText("Architecture and\nCode Intelligence", {
    x: 1.2, y: 2.85, w: 7.6, h: 1.1,
    fontSize: 26, fontFace: HDR, color: WHITE, align: "center", lineSpacingMultiple: 1.15, margin: 0
  });

  // Thin accent line
  s1.addShape(pres.shapes.RECTANGLE, { x: 4.0, y: 4.15, w: 2.0, h: 0.025, fill: { color: ACCENT } });

  // Founder + stage
  s1.addText("Mushegh Gevorgyan  |  Founder", {
    x: 1, y: 4.4, w: 8, h: 0.4, fontSize: 13, fontFace: BODY, color: GRAY_LIGHT, align: "center"
  });
  s1.addText("Pre-Seed  |  2026", {
    x: 1, y: 4.85, w: 8, h: 0.35, fontSize: 11, fontFace: BODY, color: GRAY_DIM, align: "center"
  });

  // ════════════════════════════════════════
  // SLIDE 2 — PROBLEM (bold headline + stacked)
  // ════════════════════════════════════════
  let s2 = pres.addSlide();
  s2.background = { color: BG_MID };

  s2.addText("The Problem", {
    x: 0.8, y: 0.3, w: 6, h: 0.65, fontSize: 38, fontFace: HDR, color: WHITE, margin: 0
  });

  s2.addText("AI writes the code. Nobody reviews the architecture.", {
    x: 0.8, y: 0.95, w: 7, h: 0.4, fontSize: 15, fontFace: BODY, color: ACCENT2, margin: 0
  });

  const problems = [
    { ic: icBolt, title: "Speed without structure", body: "AI generates code fast. Architectural debt accumulates faster." },
    { ic: icBug,  title: "Invisible decay", body: "Linters catch syntax. They miss circular dependencies, layer violations, dead modules, race conditions." },
    { ic: icClock, title: "10x cost of delay", body: "Teams ship on top of rotting foundations. By the time they notice, refactoring costs 10x." },
  ];

  problems.forEach((p, i) => {
    const y = 1.65 + i * 1.2;
    s2.addShape(pres.shapes.OVAL, { x: 0.8, y: y + 0.15, w: 0.55, h: 0.55, fill: { color: ACCENT, transparency: 85 } });
    s2.addImage({ data: p.ic, x: 0.88, y: y + 0.22, w: 0.38, h: 0.38 });
    s2.addText(p.title, {
      x: 1.6, y: y + 0.05, w: 7, h: 0.35, fontSize: 17, fontFace: BODY, color: WHITE, bold: true, margin: 0
    });
    s2.addText(p.body, {
      x: 1.6, y: y + 0.42, w: 7, h: 0.45, fontSize: 13, fontFace: BODY, color: GRAY_LIGHT, margin: 0
    });
    if (i < 2) {
      s2.addShape(pres.shapes.LINE, { x: 1.6, y: y + 0.95, w: 6.5, h: 0, line: { color: "2A2A2A", width: 1 } });
    }
  });

  // ════════════════════════════════════════
  // SLIDE 3 — WHY NOW (big stats, horizontal)
  // ════════════════════════════════════════
  let s3 = pres.addSlide();
  s3.background = { color: BG_DARK };

  s3.addText("Why Now", {
    x: 0.8, y: 0.3, w: 6, h: 0.65, fontSize: 38, fontFace: HDR, color: WHITE, margin: 0
  });

  // Full-width accent stripe behind stats
  s3.addShape(pres.shapes.RECTANGLE, { x: 0, y: 1.3, w: W, h: 2.9, fill: { color: BG_CARD } });

  const stats = [
    { num: "92%", label: "Of US devs use AI coding tools", sub: "Daily usage, 2026" },
    { num: "46%", label: "Of all new code is AI-generated", sub: "And growing fast" },
    { num: "$2B+", label: "Cursor ARR alone", sub: "1M+ daily active users" },
  ];

  stats.forEach((s, i) => {
    const x = 0.5 + i * 3.3;
    s3.addText(s.num, {
      x: x, y: 1.45, w: 3.0, h: 1.1, fontSize: 56, fontFace: HDR, color: ACCENT, align: "center", margin: 0
    });
    s3.addText(s.label, {
      x: x, y: 2.55, w: 3.0, h: 0.4, fontSize: 15, fontFace: BODY, color: WHITE, bold: true, align: "center", margin: 0
    });
    s3.addText(s.sub, {
      x: x, y: 2.95, w: 3.0, h: 0.4, fontSize: 12, fontFace: BODY, color: GRAY, align: "center", margin: 0
    });
    if (i < 2) {
      s3.addShape(pres.shapes.LINE, { x: x + 3.15, y: 1.7, w: 0, h: 1.6, line: { color: "333333", width: 1 } });
    }
  });

  s3.addText("Cursor: 1M+ daily users  \u00b7  Claude Code: $2.5B ARR  \u00b7  Codex: 2M+ weekly users", {
    x: 0.8, y: 4.5, w: 8.4, h: 0.5, fontSize: 13, fontFace: BODY, color: GRAY, italic: true
  });

  // ════════════════════════════════════════
  // SLIDE 4 — SOLUTION (hero left + features right)
  // ════════════════════════════════════════
  let s4 = pres.addSlide();
  s4.background = { color: BG_MID };

  // Left hero panel
  s4.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 3.8, h: H, fill: { color: BG_DARK } });
  s4.addText("True\nCourse", {
    x: 0.4, y: 0.8, w: 3.0, h: 1.6, fontSize: 42, fontFace: HDR, color: WHITE, margin: 0, lineSpacingMultiple: 1.0
  });
  s4.addText("Local-first architecture\nand code intelligence", {
    x: 0.4, y: 2.5, w: 3.0, h: 0.8, fontSize: 14, fontFace: BODY, color: GRAY_LIGHT, margin: 0
  });

  const features = [
    { ic: icCogs,  t: "Static + LLM analysis", d: "Tree-sitter AST parsing combined with LLM semantic review" },
    { ic: icGraph, t: "Beyond linting", d: "Circular deps, layer violations, race conditions, security anti-patterns" },
    { ic: icLock,  t: "Fully local", d: "Everything runs on your machine. Code never leaves your environment." },
    { ic: icTerm,  t: "Two interfaces", d: "Web UI for developers. CLI for AI coding agents." },
  ];

  features.forEach((f, i) => {
    const y = 0.5 + i * 1.2;
    s4.addShape(pres.shapes.OVAL, { x: 4.3, y: y + 0.05, w: 0.6, h: 0.6, fill: { color: BG_CARD2 } });
    s4.addImage({ data: f.ic, x: 4.4, y: y + 0.15, w: 0.4, h: 0.4 });
    s4.addText(f.t, {
      x: 5.15, y: y, w: 4.5, h: 0.35, fontSize: 15, fontFace: BODY, color: WHITE, bold: true, margin: 0
    });
    s4.addText(f.d, {
      x: 5.15, y: y + 0.38, w: 4.5, h: 0.5, fontSize: 12, fontFace: BODY, color: GRAY_LIGHT, margin: 0
    });
  });

  // ════════════════════════════════════════
  // SLIDE 5 — HOW IT WORKS (horizontal pipeline)
  // ════════════════════════════════════════
  let s5 = pres.addSlide();
  s5.background = { color: BG_DARK };

  s5.addText("How It Works", {
    x: 0.8, y: 0.3, w: 6, h: 0.65, fontSize: 38, fontFace: HDR, color: WHITE, margin: 0
  });

  // Pipeline track line
  s5.addShape(pres.shapes.LINE, { x: 1.5, y: 2.35, w: 6.5, h: 0, line: { color: "333333", width: 3 } });

  const steps = [
    { num: "1", t: "Run", sub: "npx truecourse analyze", detail: "One command. Zero config." },
    { num: "2", t: "Analyze", sub: "AST + LLM review", detail: "Tree-sitter parsing + semantic analysis" },
    { num: "3", t: "Act", sub: "Graph + violations + fixes", detail: "Interactive results with suggestions" },
  ];

  steps.forEach((st, i) => {
    const cx = 1.5 + i * 3.25;
    s5.addShape(pres.shapes.OVAL, { x: cx - 0.4, y: 1.95, w: 0.8, h: 0.8, fill: { color: ACCENT } });
    s5.addText(st.num, {
      x: cx - 0.4, y: 1.95, w: 0.8, h: 0.8, fontSize: 24, fontFace: HDR, color: WHITE,
      align: "center", valign: "middle", margin: 0
    });
    s5.addText(st.t, {
      x: cx - 1.2, y: 2.95, w: 2.4, h: 0.35, fontSize: 18, fontFace: HDR, color: WHITE, align: "center", margin: 0
    });
    s5.addText(st.sub, {
      x: cx - 1.2, y: 3.35, w: 2.4, h: 0.35, fontSize: 12, fontFace: "Consolas", color: ACCENT2, align: "center", margin: 0
    });
    s5.addText(st.detail, {
      x: cx - 1.2, y: 3.7, w: 2.4, h: 0.4, fontSize: 11, fontFace: BODY, color: GRAY, align: "center", margin: 0
    });
  });

  s5.addText("Works with Claude Code (no API key needed), Anthropic API, or OpenAI API", {
    x: 0.8, y: 4.6, w: 8.4, h: 0.4, fontSize: 11, fontFace: BODY, color: GRAY_DIM, italic: true, align: "center"
  });

  // ════════════════════════════════════════
  // PRODUCT SLIDES (6a–6f) — one per feature
  // ════════════════════════════════════════

  // Helper: product feature slide with screenshot area (left text, right screenshot)
  function addProductSlide(title, subtitle, description, imgPath) {
    const sl = pres.addSlide();
    sl.background = { color: BG_DARK };

    // Title
    sl.addText(title, {
      x: 0.8, y: 0.3, w: 8, h: 0.55, fontSize: 32, fontFace: HDR, color: WHITE, margin: 0
    });
    // Subtitle
    sl.addText(subtitle, {
      x: 0.8, y: 0.85, w: 8, h: 0.35, fontSize: 14, fontFace: BODY, color: ACCENT2, margin: 0
    });

    if (imgPath) {
      // Full-width screenshot
      const scrH = 3.6;
      const scrW = scrH * (3024 / 1895);
      const scrX = (W - scrW) / 2;
      sl.addShape(pres.shapes.RECTANGLE, {
        x: scrX - 0.1, y: 1.4, w: scrW + 0.2, h: scrH + 0.2,
        fill: { color: ACCENT, transparency: 93 },
        shadow: { type: "outer", blur: 20, offset: 0, angle: 0, color: ACCENT, opacity: 0.12 }
      });
      sl.addImage({ path: imgPath, x: scrX, y: 1.5, w: scrW, h: scrH });
    } else {
      // Placeholder
      sl.addShape(pres.shapes.RECTANGLE, {
        x: 0.8, y: 1.4, w: 8.4, h: 3.6,
        fill: { color: BG_CARD },
        line: { color: "333333", width: 1, dashType: "dash" }
      });
      sl.addText("[ Screenshot placeholder ]", {
        x: 0.8, y: 2.8, w: 8.4, h: 0.5,
        fontSize: 14, fontFace: BODY, color: GRAY_DIM, align: "center"
      });
    }

    // Description at bottom
    if (description) {
      sl.addText(description, {
        x: 0.8, y: 5.15, w: 8.4, h: 0.3,
        fontSize: 11, fontFace: BODY, color: GRAY, align: "center"
      });
    }

    return sl;
  }

  // 6a — Architecture Graph (existing screenshot)
  addProductSlide(
    "Architecture Graph",
    "Visualize dependencies across services, modules, and methods",
    "Interactive React Flow graph  \u00b7  Filter by services, modules, functions  \u00b7  Click to explore",
    screenshotPath
  );

  // 6b — Inline Code Review
  addProductSlide(
    "Inline Code Review",
    "Violations highlighted directly in your source code",
    "Severity markers  \u00b7  Highlighted ranges  \u00b7  Fix suggestions  \u00b7  Deterministic + LLM rules",
    null // placeholder
  );

  // 6c — Cross-Service Flow Tracing
  addProductSlide(
    "Flow Tracing",
    "End-to-end request flows across service boundaries",
    "HTTP calls  \u00b7  Route handlers  \u00b7  Method chains  \u00b7  Violation indicators along the path",
    null // placeholder
  );

  // 6d — Database ER Diagrams
  addProductSlide(
    "Database Analysis",
    "Auto-detected ER diagrams from ORM usage",
    "Prisma, TypeORM, Drizzle, Knex  \u00b7  Tables, columns, relationships  \u00b7  Schema issue detection",
    null // placeholder
  );

  // 6e — Historical Analytics
  addProductSlide(
    "Historical Analytics",
    "Track architecture health over time",
    "Violation trends  \u00b7  New vs resolved  \u00b7  Severity breakdown  \u00b7  Code hotspots",
    null // placeholder
  );

  // 6f — Git Diff Mode
  addProductSlide(
    "Git Diff Mode",
    "See what your uncommitted changes break or fix",
    "New violations  \u00b7  Resolved violations  \u00b7  Affected nodes highlighted in graph",
    null // placeholder
  );

  // ════════════════════════════════════════
  // SLIDE 7 — MARKET (asymmetric layout)
  // ════════════════════════════════════════
  let s7 = pres.addSlide();
  s7.background = { color: BG_MID };

  s7.addText("Market", {
    x: 0.8, y: 0.3, w: 6, h: 0.65, fontSize: 38, fontFace: HDR, color: WHITE, margin: 0
  });

  s7.addText("$10B", {
    x: 0.6, y: 1.2, w: 2.2, h: 1.0, fontSize: 56, fontFace: HDR, color: ACCENT, margin: 0
  });
  s7.addText("AI coding tools\nmarket in 2026", {
    x: 2.8, y: 1.3, w: 2.0, h: 0.7, fontSize: 13, fontFace: BODY, color: GRAY_LIGHT, margin: 0
  });

  s7.addText("$45B+", {
    x: 0.6, y: 2.25, w: 2.2, h: 0.8, fontSize: 42, fontFace: HDR, color: WHITE, margin: 0
  });
  s7.addText("projected by 2030\n~35% CAGR", {
    x: 2.8, y: 2.3, w: 2.0, h: 0.7, fontSize: 13, fontFace: BODY, color: GRAY, margin: 0
  });

  s7.addShape(pres.shapes.LINE, { x: 0.8, y: 3.25, w: 3.5, h: 0, line: { color: "333333", width: 1 } });

  s7.addText("Bottom-Up Revenue", {
    x: 0.8, y: 3.45, w: 4.0, h: 0.35, fontSize: 14, fontFace: BODY, color: WHITE, bold: true, margin: 0
  });
  s7.addText("500 teams \u00d7 5 devs \u00d7 $30/mo = $900K ARR (Year 1\u20132)\n5,000 teams \u00d7 8 devs \u00d7 $35/mo avg = $16.8M ARR (Year 3)", {
    x: 0.8, y: 3.85, w: 4.0, h: 0.8, fontSize: 12, fontFace: BODY, color: GRAY_LIGHT, margin: 0
  });

  // Right card
  s7.addShape(pres.shapes.RECTANGLE, { x: 5.5, y: 1.2, w: 4.0, h: 3.8, fill: { color: BG_CARD }, shadow: shadow() });
  s7.addShape(pres.shapes.RECTANGLE, { x: 5.5, y: 1.2, w: 0.06, h: 3.8, fill: { color: ACCENT } });

  s7.addText("Target Segment", {
    x: 5.85, y: 1.4, w: 3.5, h: 0.4, fontSize: 18, fontFace: BODY, color: WHITE, bold: true, margin: 0
  });
  s7.addText("Teams using AI code generation", {
    x: 5.85, y: 1.82, w: 3.5, h: 0.35, fontSize: 12, fontFace: BODY, color: GRAY_LIGHT, margin: 0
  });

  const segments = ["Cursor: 1M+ daily active users", "Claude Code: $2.5B ARR, doubled since Jan 2026", "Codex: 2M+ weekly active users"];
  segments.forEach((seg, i) => {
    s7.addImage({ data: icChev, x: 5.85, y: 2.45 + i * 0.45, w: 0.2, h: 0.2 });
    s7.addText(seg, {
      x: 6.15, y: 2.35 + i * 0.45, w: 3.1, h: 0.4, fontSize: 12, fontFace: BODY, color: GRAY_LIGHT, margin: 0
    });
  });

  s7.addShape(pres.shapes.LINE, { x: 5.85, y: 3.85, w: 3.3, h: 0, line: { color: "333333", width: 1 } });
  s7.addText("Wedge", {
    x: 5.85, y: 4.0, w: 3.5, h: 0.3, fontSize: 13, fontFace: BODY, color: ACCENT2, bold: true, margin: 0
  });
  s7.addText("Open-source CLI\n\u2192 paid team/enterprise features", {
    x: 5.85, y: 4.3, w: 3.5, h: 0.5, fontSize: 12, fontFace: BODY, color: GRAY_LIGHT, margin: 0
  });

  // ════════════════════════════════════════
  // SLIDE 8 — BUSINESS MODEL (split comparison)
  // ════════════════════════════════════════
  let s8 = pres.addSlide();
  s8.background = { color: BG_DARK };

  s8.addText("Open Core", {
    x: 0.8, y: 0.3, w: 6, h: 0.65, fontSize: 38, fontFace: HDR, color: WHITE, margin: 0
  });

  // FREE
  s8.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.2, w: 4.3, h: 3.2, fill: { color: BG_CARD } });
  s8.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.2, w: 4.3, h: 0.5, fill: { color: ACCENT, transparency: 80 } });
  s8.addText("FREE", { x: 0.7, y: 1.22, w: 2, h: 0.45, fontSize: 16, fontFace: HDR, color: ACCENT2, margin: 0 });
  s8.addText("Open Source", { x: 2.2, y: 1.27, w: 2.4, h: 0.4, fontSize: 12, fontFace: BODY, color: GRAY_LIGHT, align: "right", margin: 0 });

  const freeItems = ["Local analysis engine", "CLI for AI coding agents", "Core architecture + code rules", "Single-user web UI"];
  freeItems.forEach((item, i) => {
    s8.addImage({ data: icChev, x: 0.8, y: 1.95 + i * 0.5, w: 0.22, h: 0.22 });
    s8.addText(item, { x: 1.15, y: 1.88 + i * 0.5, w: 3.4, h: 0.35, fontSize: 13, fontFace: BODY, color: OFF_WHITE, margin: 0 });
  });

  // PAID
  s8.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.2, w: 4.3, h: 3.2, fill: { color: BG_CARD } });
  s8.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.2, w: 4.3, h: 0.5, fill: { color: ACCENT, transparency: 70 } });
  s8.addText("PRO", { x: 5.4, y: 1.22, w: 2, h: 0.45, fontSize: 16, fontFace: HDR, color: WHITE, margin: 0 });
  s8.addText("$30/dev/mo", { x: 7.0, y: 1.27, w: 2.3, h: 0.4, fontSize: 12, fontFace: BODY, color: ACCENT2, align: "right", margin: 0 });

  const paidItems = ["Team dashboard & shared analysis", "PR gates (CI/CD integration)", "Enterprise: $40/dev/mo", "Self-hosted, custom rules, SLA support"];
  paidItems.forEach((item, i) => {
    s8.addImage({ data: icChev, x: 5.5, y: 1.95 + i * 0.5, w: 0.22, h: 0.22 });
    s8.addText(item, { x: 5.85, y: 1.88 + i * 0.5, w: 3.4, h: 0.35, fontSize: 13, fontFace: BODY, color: OFF_WHITE, margin: 0 });
  });

  s8.addText("Land with the free tool. Expand when teams adopt.", {
    x: 0.5, y: 4.65, w: 9, h: 0.4, fontSize: 15, fontFace: BODY, color: ACCENT2, italic: true, align: "center"
  });

  // ════════════════════════════════════════
  // SLIDE 9 — COMPETITIVE LANDSCAPE
  // ════════════════════════════════════════
  let s9 = pres.addSlide();
  s9.background = { color: BG_MID };

  s9.addText("Competitive Landscape", {
    x: 0.8, y: 0.3, w: 8, h: 0.65, fontSize: 38, fontFace: HDR, color: WHITE, margin: 0
  });

  const qX = 0.5, qY = 1.15, qW = 5.2, qH = 3.9;
  s9.addShape(pres.shapes.RECTANGLE, { x: qX, y: qY, w: qW, h: qH, fill: { color: BG_CARD } });
  s9.addShape(pres.shapes.LINE, { x: qX, y: qY + qH/2, w: qW, h: 0, line: { color: "333333", width: 1.5 } });
  s9.addShape(pres.shapes.LINE, { x: qX + qW/2, y: qY, w: 0, h: qH, line: { color: "333333", width: 1.5 } });

  s9.addText("ARCHITECTURE", { x: qX + 0.1, y: qY + 0.1, w: 2, h: 0.25, fontSize: 8, fontFace: BODY, color: GRAY_DIM, charSpacing: 3 });
  s9.addText("CODE-LEVEL", { x: qX + 0.1, y: qY + qH - 0.4, w: 2, h: 0.25, fontSize: 8, fontFace: BODY, color: GRAY_DIM, charSpacing: 3 });
  s9.addText("Rule-based", { x: qX + 0.1, y: qY + qH + 0.1, w: 2, h: 0.2, fontSize: 9, fontFace: BODY, color: GRAY_DIM });
  s9.addText("AI-powered", { x: qX + qW - 1.6, y: qY + qH + 0.1, w: 1.5, h: 0.2, fontSize: 9, fontFace: BODY, color: GRAY_DIM, align: "right" });

  s9.addText("SonarQube\nESLint", { x: qX + 0.3, y: qY + qH*0.6, w: 2, h: 0.6, fontSize: 12, fontFace: BODY, color: GRAY, align: "center" });
  s9.addText("CodeRabbit\nSourcery", { x: qX + qW*0.55, y: qY + qH*0.6, w: 2, h: 0.6, fontSize: 12, fontFace: BODY, color: GRAY, align: "center" });
  s9.addText("ArchUnit\nStructurizr", { x: qX + 0.3, y: qY + qH*0.12, w: 2, h: 0.6, fontSize: 12, fontFace: BODY, color: GRAY, align: "center" });

  const tcX = qX + qW*0.58, tcY = qY + qH*0.08;
  s9.addShape(pres.shapes.OVAL, { x: tcX, y: tcY, w: 2.0, h: 0.9, fill: { color: ACCENT, transparency: 15 }, line: { color: ACCENT, width: 2.5 } });
  s9.addText("TrueCourse", { x: tcX, y: tcY, w: 2.0, h: 0.9, fontSize: 14, fontFace: HDR, color: WHITE, align: "center", valign: "middle" });

  const diffs = [
    { vs: "vs SonarQube", t: "No architectural analysis.\nCloud-only. Heavy setup." },
    { vs: "vs CodeRabbit", t: "PR-level only.\nNo structural analysis. No graph." },
    { vs: "vs Both", t: "TrueCourse runs locally.\nCode never leaves your machine." },
  ];
  diffs.forEach((d, i) => {
    const y = 1.3 + i * 1.2;
    s9.addText(d.vs, { x: 6.0, y: y, w: 3.8, h: 0.3, fontSize: 14, fontFace: BODY, color: ACCENT2, bold: true, margin: 0 });
    s9.addText(d.t, { x: 6.0, y: y + 0.35, w: 3.8, h: 0.6, fontSize: 12, fontFace: BODY, color: GRAY_LIGHT, margin: 0 });
  });

  // ════════════════════════════════════════
  // SLIDE 10 — FOUNDER & ASK (split panel)
  // ════════════════════════════════════════
  let s10 = pres.addSlide();
  s10.background = { color: BG_DARK };

  // Left panel
  s10.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 4.8, h: H, fill: { color: BG_CARD } });

  s10.addText("FOUNDER", {
    x: 0.6, y: 0.4, w: 3.5, h: 0.5, fontSize: 14, fontFace: BODY, color: GRAY, charSpacing: 4, margin: 0
  });
  s10.addText("Mushegh\nGevorgyan", {
    x: 0.6, y: 0.9, w: 3.8, h: 1.2, fontSize: 32, fontFace: HDR, color: WHITE, margin: 0, lineSpacingMultiple: 1.0
  });

  const bio = [
    "20+ years in engineering",
    "Built two companies",
    "Bootstrapped first to 6-figure revenue",
    "Raised $600K+ for second company",
    "Berkeley SkyDeck Europe Alumni",
  ];
  bio.forEach((item, i) => {
    s10.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 2.45 + i * 0.5, w: 0.25, h: 0.02, fill: { color: ACCENT } });
    s10.addText(item, {
      x: 1.05, y: 2.35 + i * 0.5, w: 3.5, h: 0.35, fontSize: 12, fontFace: BODY, color: GRAY_LIGHT, margin: 0
    });
  });

  // Right — The Ask
  s10.addText("THE ASK", {
    x: 5.5, y: 0.4, w: 4, h: 0.5, fontSize: 14, fontFace: BODY, color: GRAY, charSpacing: 4, margin: 0
  });

  s10.addText("$150K\u2013$250K", {
    x: 5.5, y: 1.0, w: 4.2, h: 0.7, fontSize: 38, fontFace: HDR, color: ACCENT, margin: 0
  });
  s10.addText("Pre-Seed", {
    x: 5.5, y: 1.75, w: 4, h: 0.35, fontSize: 14, fontFace: BODY, color: GRAY, margin: 0
  });

  s10.addShape(pres.shapes.LINE, { x: 5.5, y: 2.25, w: 3.5, h: 0, line: { color: "333333", width: 1 } });

  s10.addText("Use of Funds", {
    x: 5.5, y: 2.45, w: 4, h: 0.35, fontSize: 14, fontFace: BODY, color: WHITE, bold: true, margin: 0
  });

  const funds = ["Community growth and adoption", "Conferences, hackathons, sponsorships", "Launch paid tier"];
  funds.forEach((item, i) => {
    s10.addImage({ data: icChev, x: 5.5, y: 3.0 + i * 0.5, w: 0.2, h: 0.2 });
    s10.addText(item, {
      x: 5.85, y: 2.93 + i * 0.5, w: 3.5, h: 0.35, fontSize: 13, fontFace: BODY, color: GRAY_LIGHT, margin: 0
    });
  });

  // Status badge
  s10.addShape(pres.shapes.RECTANGLE, {
    x: 5.5, y: 4.5, w: 3.8, h: 0.55, fill: { color: ACCENT, transparency: 88 },
    line: { color: ACCENT, width: 1 }
  });
  s10.addText("Working product  \u00b7  Open source  \u00b7  Published on npm", {
    x: 5.5, y: 4.5, w: 3.8, h: 0.55, fontSize: 11, fontFace: BODY, color: ACCENT2,
    align: "center", valign: "middle"
  });

  // ─── WRITE ───
  const out = "/Users/musheghgevorgyan/repos/truecourse/assets/TrueCourse_Pitch_Deck.pptx";
  await pres.writeFile({ fileName: out });
  console.log("Done: " + out);
}

buildDeck().catch(e => { console.error(e); process.exit(1); });
