// Run with: node --test tests/editor-isolation.test.cjs
// No dependencies: exercise the actual inline application script in a small DOM sandbox.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const html = fs.readFileSync(require("node:path").join(__dirname, "..", "index.html"), "utf8");
const match = html.match(/<script>\s*"use strict";([\s\S]*?)<\/script>/);
assert.ok(match, "main application script exists");
const application = '"use strict";' + match[1];
// Parse the original script without mocking or executing browser APIs.
new vm.Script(application, { filename: "wordvault-inline.js" });

function launch() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        id, hidden: false, disabled: false, value: "", textContent: "",
        checked: false, children: [], dataset: {},
        style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
        setAttribute() {}, removeAttribute() {}, addEventListener() {}, removeEventListener() {},
        append() {}, replaceChildren() {}, focus() {},
      });
    }
    return elements.get(id);
  };
  const window = { addEventListener() {} };
  const document = {
    getElementById: element,
    querySelector: element,
    querySelectorAll: () => [],
    createElement: () => element(Symbol()),
    addEventListener() {},
  };

  const expose = `
    renderConstructor = () => updateBookContextBanner();
    renderBooks = () => {};
    renderTopics = () => {};
    renderBookDetail = () => {};
    stateChanged = () => {};
    window.__test = {
      emptyBoard, validateState, commitBoard, isBookEditor, currentBoardEntity,
      openTopicInConstructor, switchTab, autoSaveMetaOnly, updateBookContextBanner,
      state: () => state,
      attachBook: (id, book) => { state.books[id] = book; },
      setGenerator: generator => { generateGrid = generator; },
      activeTopic: () => activeBookTopicIndex,
    };
  `;
  const code = application.replace('window.addEventListener("DOMContentLoaded", init);',
    expose + '\n    window.addEventListener("DOMContentLoaded", init);');
  assert.notEqual(code, application, "test hooks inserted");
  vm.runInNewContext(code, {
    window, document, crypto: webcrypto, setTimeout, clearTimeout,
    navigator: {}, performance: { now: () => Date.now() },
    Uint8Array, console, TextEncoder, TextDecoder,
  });
  return { api: window.__test, element };
}

function makeBoard(api, name, word) {
  const b = api.emptyBoard();
  b.id = name;
  b.name = name;
  b.raw = word;
  b.words = [word];
  for (let i = 0; i < word.length; i++) b.grid[i] = word[i];
  b.placements = [{ word, cells: [...word].map((_, i) => i) }];
  return b;
}

function makeTopic(board) {
  return {
    id: board.id, name: board.name, raw: board.raw, words: [...board.words],
    grid: [...board.grid], placements: JSON.parse(JSON.stringify(board.placements))
  };
}

test("book edit never overwrites the standalone draft", async () => {
  const { api, element } = launch();
  const standalone = makeBoard(api, "Independent", "SUN");
  const bookBoard = makeBoard(api, "Book topic", "MOON");
  api.commitBoard(standalone);
  api.attachBook("b1", {
    id: "b1", title: "Book", settings: api.emptyBoard().settings,
    topics: [makeTopic(bookBoard)], updatedAt: 1
  });

  api.openTopicInConstructor("b1", 0);
  assert.equal(api.isBookEditor(), true);
  assert.equal(api.currentBoardEntity().value.name, "Book topic");
  assert.equal(api.state().board.value.name, "Independent");
  assert.equal(element("freeContextBanner").hidden, true);
  assert.equal(element("bookContextBanner").hidden, false);

  const edited = { ...api.currentBoardEntity().value, name: "Book edited" };
  api.commitBoard(edited);
  assert.equal(api.state().books.b1.topics[0].name, "Book edited");
  assert.equal(api.state().board.value.name, "Independent");

  await api.switchTab("books");
  await api.switchTab("constructor");
  assert.equal(api.isBookEditor(), false);
  assert.equal(api.currentBoardEntity().value.name, "Independent");
  assert.equal(element("freeContextBanner").hidden, false);
  assert.equal(element("bookContextBanner").hidden, true);
});

test("main Constructor navigation exits book mode without changing either board", async () => {
  const { api } = launch();
  const independent = makeBoard(api, "Free board", "STAR");
  api.commitBoard(independent);
  const bookGrid = makeBoard(api, "Book grid", "MARS");
  api.attachBook("b1", {
    id: "b1", title: "Collection", settings: api.emptyBoard().settings,
    topics: [makeTopic(bookGrid)], updatedAt: 1,
  });
  api.openTopicInConstructor("b1", 0);
  await api.switchTab("constructor"); // Main navigation button, not book-specific entry
  assert.equal(api.isBookEditor(), false);
  assert.equal(api.currentBoardEntity().value.name, "Free board");
  assert.equal(api.state().books.b1.topics[0].name, "Book grid");
});

test("metadata edits are scoped to the selected book topic", () => {
  const { api, element } = launch();
  api.commitBoard(makeBoard(api, "Free name", "SUN"));
  api.attachBook("b1", {
    id: "b1", title: "Collection", settings: api.emptyBoard().settings,
    topics: [makeTopic(makeBoard(api, "Book name", "MOON"))], updatedAt: 1,
  });
  api.openTopicInConstructor("b1", 0);
  element("topicName").value = "Renamed inside book";
  element("wordsInput").value = "MARS";
  api.autoSaveMetaOnly();
  assert.equal(api.state().books.b1.topics[0].name, "Renamed inside book");
  assert.equal(api.state().books.b1.topics[0].raw, "MARS");
  assert.equal(api.state().board.value.name, "Free name");
  assert.equal(api.state().board.value.raw, "SUN");
});

test("legacy last-book board is migrated, unrelated free boards are preserved", () => {
  const { api } = launch();
  const matching = makeBoard(api, "Copied book grid", "MOON");
  const base = {
    schema: 4, board: { rev: { n: 1, by: "old" }, ancestors: [], value: matching },
    topics: {}, books: {
      b1: { id: "b1", title: "Book", settings: api.emptyBoard().settings,
        topics: [makeTopic(matching)], updatedAt: 1 }
    }, game: null
  };
  const migrated = api.validateState(base);
  assert.equal(migrated.freeBoardIsolated, true);
  assert.deepEqual(Array.from(migrated.board.value.words), []);
  assert.equal(migrated.books.b1.topics[0].name, "Copied book grid");

  const independent = api.validateState({
    ...base, board: { ...base.board, value: makeBoard(api, "Independent", "SUN") }
  });
  assert.equal(independent.board.value.name, "Independent");
  assert.equal(independent.board.value.words[0], "SUN");
});

test("late async generation does not resurrect a closed book session", async () => {
  const { api } = launch();
  api.commitBoard(makeBoard(api, "Free work", "SUN"));
  const bookGrid = makeBoard(api, "To generate", "MOON");
  const topic = { ...makeTopic(bookGrid), grid: null, placements: [] };
  api.attachBook("b1", {
    id: "b1", title: "Book", settings: api.emptyBoard().settings,
    topics: [topic], updatedAt: 1
  });
  let resolve;
  api.setGenerator(() => new Promise(r => { resolve = r; }));
  api.openTopicInConstructor("b1", 0);
  await api.switchTab("books");
  await api.switchTab("constructor");
  resolve({ grid: bookGrid.grid, placements: bookGrid.placements });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(api.isBookEditor(), false);
  assert.equal(api.state().books.b1.topics[0].grid, null);
  assert.equal(api.state().board.value.name, "Free work");
});
