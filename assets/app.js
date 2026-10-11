  "use strict";

  (() => {
    const $ = id => document.getElementById(id);
    const SIZE = 15;
    const CELLS = SIZE * SIZE;
    const SCHEMA = 4;
    const MAX_WORDS = 200;
    const MAX_TOPICS = 500;
    const MAX_PAYLOAD = 6 * 1024 * 1024;

    const COLORS = [
      "#60a5fa", "#34d399", "#f472b6", "#fbbf24", "#a78bfa",
      "#2dd4bf", "#fb7185", "#22d3ee", "#c084fc", "#a3e635",
      "#818cf8", "#fb923c", "#4ade80", "#e879f9", "#38bdf8"
    ];

    const ALL_DIRS = [
      [0, 1, "→"], [0, -1, "←"],
      [1, 0, "↓"], [-1, 0, "↑"],
      [1, 1, "↘"], [-1, -1, "↖"],
      [1, -1, "↙"], [-1, 1, "↗"]
    ];

    const RU_WEIGHTS = [
      ["О",10.97],["Е",8.45],["А",8.01],["И",7.35],["Н",6.70],
      ["Т",6.26],["С",5.47],["Р",4.73],["В",4.54],["Л",4.40],
      ["К",3.49],["М",3.21],["Д",2.98],["П",2.81],["У",2.62],
      ["Я",2.01],["Ы",1.90],["Ь",1.74],["Г",1.70],["З",1.65],
      ["Б",1.59],["Ч",1.44],["Й",1.21],["Х",0.97],["Ж",0.94],
      ["Ш",0.73],["Ю",0.64],["Ц",0.48],["Щ",0.36],["Э",0.32],
      ["Ф",0.26],["Ъ",0.04]
    ];

    const EN_WEIGHTS = [
      ["E",12.70],["T",9.06],["A",8.17],["O",7.51],["I",6.97],
      ["N",6.75],["S",6.33],["H",6.09],["R",5.99],["D",4.25],
      ["L",4.03],["C",2.78],["U",2.76],["M",2.41],["W",2.36],
      ["F",2.23],["G",2.02],["Y",1.97],["P",1.93],["B",1.49],
      ["V",0.98],["K",0.77],["J",0.15],["X",0.15],["Q",0.10],["Z",0.07]
    ];

    const DEFAULT_SETTINGS = {
      h: true, v: true, d: true, reverse: true, filler: "freq", overlap: true
    };

    const clone = value => JSON.parse(JSON.stringify(value));
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    function confirmModal(message, title = "Подтверждение") {
      return new Promise(resolve => {
        const dlg = $("confirmDialog");
        $("confirmTitle").textContent = title;
        $("confirmMessage").textContent = message;

        const onOk = e => { e?.preventDefault(); cleanup(); resolve(true); };
        const onCancel = e => { e?.preventDefault(); cleanup(); resolve(false); };

        function cleanup() {
          $("confirmOk").removeEventListener("click", onOk);
          $("confirmCancel").removeEventListener("click", onCancel);
          dlg.removeEventListener("close", onCancel);
          try { dlg.close(); } catch {}
        }

        $("confirmOk").addEventListener("click", onOk, { once: true });
        $("confirmCancel").addEventListener("click", onCancel, { once: true });
        dlg.addEventListener("close", onCancel, { once: true });
        dlg.showModal();
      });
    }

    function uid() {
      if (crypto.randomUUID) return crypto.randomUUID();
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, n => n.toString(16).padStart(2, "0")).join("");
    }

    function stable(value) {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
      return "{" + Object.keys(value).sort().map(k =>
        JSON.stringify(k) + ":" + stable(value[k])
      ).join(",") + "}";
    }

    function toast(message) {
      const el = document.createElement("div");
      el.className = "toast";
      el.textContent = message;
      $("toasts").append(el);
      setTimeout(() => el.remove(), 4500);
    }

    function node(tag, className, text) {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (text !== undefined) el.textContent = text;
      return el;
    }

    function action(text, handler, className = "") {
      const button = node("button", className, text);
      button.type = "button";
      button.addEventListener("click", handler);
      return button;
    }

    function coord(index) {
      return String.fromCharCode(65 + index % SIZE) + (Math.floor(index / SIZE) + 1);
    }

    function directionOf(cells) {
      if (cells.length < 2) return "";
      const a = cells[0], b = cells[1];
      const dr = Math.floor(b / SIZE) - Math.floor(a / SIZE);
      const dc = b % SIZE - a % SIZE;
      return ALL_DIRS.find(d => d[0] === dr && d[1] === dc)?.[2] || "";
    }

    function pathText(cells) {
      return `${coord(cells[0])}–${coord(cells[cells.length - 1])} ${directionOf(cells)}`;
    }

    function normalize(text) {
      return String(text || "").toUpperCase().replace(/Ё/g, "Е");
    }

    function parseWords(raw) {
      const tokens = normalize(raw).match(/[А-ЯA-Z]+/g) || [];
      const words = [];
      const rejected = [];
      const seen = new Set();
      let duplicates = 0;

      for (const token of tokens) {
        if (seen.has(token)) { duplicates++; continue; }
        seen.add(token);

        if (token.length < 2 || token.length > SIZE) {
          rejected.push(`${token.slice(0, 35)} — ${token.length} букв`);
        } else if (words.length >= MAX_WORDS) {
          rejected.push(`${token} — лимит ${MAX_WORDS} слов`);
        } else {
          words.push(token);
        }
      }

      return { words, rejected, duplicates };
    }

    function parseBatchInput(text, autoSplit = true) {
      const lines = text.split(/\r?\n/);
      const rawBlocks = [];
      let curTitle = "";
      let curWordsLines = [];

      function flush() {
        const wordsRaw = curWordsLines.join(" ").trim();
        if (curTitle || wordsRaw) {
          const parsed = parseWords(wordsRaw);
          rawBlocks.push({
            title: curTitle.trim(),
            wordsRaw,
            words: parsed.words,
            rejected: parsed.rejected,
            duplicates: parsed.duplicates
          });
          curTitle = "";
          curWordsLines = [];
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed) continue;

        let isHeader = false;
        let extTitle = "";
        let inlineWords = "";

        if (/^#{1,4}\s+/.test(trimmed)) {
          isHeader = true;
          extTitle = trimmed.replace(/^#{1,4}\s+/, "");
        } else if (/^(?:тема\s*\d*[:.]?|\d+[\s.)\-]+)/i.test(trimmed)) {
          if (trimmed.includes(":") && !trimmed.endsWith(":")) {
            const colonIdx = trimmed.indexOf(":");
            const before = trimmed.slice(0, colonIdx).replace(/^(?:тема\s*\d*[:.]?|\d+[\s.)\-]+)/i, "").trim();
            const after = trimmed.slice(colonIdx + 1).trim();
            isHeader = true;
            extTitle = before || trimmed.slice(0, colonIdx).trim();
            inlineWords = after;
          } else {
            isHeader = true;
            extTitle = trimmed.replace(/^(?:тема\s*\d*[:.]?|\d+[\s.)\-]+)/i, "").replace(/[:.]+$/, "").trim();
            if (!extTitle) extTitle = trimmed;
          }
        } else if ((trimmed.includes(":") || trimmed.includes("\t")) && !trimmed.endsWith(":")) {
          const sep = trimmed.includes(":") ? ":" : "\t";
          const parts = trimmed.split(sep);
          const maybeTitle = parts[0].trim();
          const maybeWords = parts.slice(1).join(" ").trim();
          if (maybeTitle.length >= 2 && maybeTitle.length <= 60 && !maybeTitle.includes(",")) {
            isHeader = true;
            extTitle = maybeTitle;
            inlineWords = maybeWords;
          }
        } else if (curWordsLines.length > 0 && !trimmed.includes(",") && trimmed.length <= 50 && trimmed.split(/\s+/).length <= 4) {
          if (/[А-ЯA-Zа-яa-z]/.test(trimmed)) {
            isHeader = true;
            extTitle = trimmed;
          }
        }

        if (isHeader) {
          if (curWordsLines.length > 0) flush();
          curTitle = extTitle;
          if (inlineWords) curWordsLines.push(inlineWords);
        } else {
          if (!curTitle && curWordsLines.length === 0 && !trimmed.includes(",") && trimmed.length <= 50 && trimmed.split(/\s+/).length <= 4) {
            curTitle = trimmed;
          } else {
            curWordsLines.push(trimmed);
          }
        }
      }

      flush();

      const processed = [];
      const warnings = [];

      rawBlocks.forEach((block, idx) => {
        const name = block.title || `Тема ${idx + 1}`;
        const words = block.words;

        if (!words.length) {
          warnings.push(`Тема #${idx + 1} «${name}»: нет слов от 2 до 15 букв`);
          processed.push({
            name,
            words: [],
            raw: block.wordsRaw,
            rejected: block.rejected,
            duplicates: block.duplicates,
            status: "error",
            statusText: "Нет допустимых слов"
          });
          return;
        }

        if (autoSplit && words.length > 25) {
          const chunkSize = words.length > 40 ? Math.ceil(words.length / 2) : 20;
          let partNum = 1;
          for (let s = 0; s < words.length; s += chunkSize) {
            const chunk = words.slice(s, s + chunkSize);
            processed.push({
              name: `${name} (Часть ${partNum})`,
              words: chunk,
              raw: chunk.join(", "),
              rejected: partNum === 1 ? block.rejected : [],
              duplicates: partNum === 1 ? block.duplicates : 0,
              status: "ok",
              statusText: `${chunk.length} слов (авто-разделено)`
            });
            partNum++;
          }
        } else {
          let status = "ok";
          let statusText = `${words.length} слов`;

          if (words.length > 25) {
            status = "warn";
            statusText = `${words.length} слов (много для 15×15)`;
            warnings.push(`Тема «${name}»: ${words.length} слов — часть может не поместиться`);
          } else if (words.length < 5) {
            status = "warn";
            statusText = `${words.length} слов (мало слов)`;
          }

          processed.push({
            name,
            words,
            raw: block.wordsRaw,
            rejected: block.rejected,
            duplicates: block.duplicates,
            status,
            statusText
          });
        }
      });

      return { topics: processed, warnings };
    }

    const DB = {
      driver: "idb",
      db: null,
      memoryStore: new Map(),
      ok: false,
      queue: Promise.resolve(),

      async open() {
        return new Promise(resolve => {
          let completed = false;
          const finish = (isOk, driverName) => {
            if (completed) return;
            completed = true;
            this.ok = isOk;
            this.driver = driverName;
            resolve(isOk);
          };

          try {
            if (!window.indexedDB) {
              this.initFallback(finish);
              return;
            }

            const request = indexedDB.open("WordVault_Permanent_DB", 2);

            request.onupgradeneeded = () => {
              if (!request.result.objectStoreNames.contains("app_state")) {
                request.result.createObjectStore("app_state");
              }
            };

            request.onsuccess = () => {
              this.db = request.result;
              this.db.onversionchange = () => this.db.close();
              finish(true, "IndexedDB");
            };

            request.onerror = () => this.initFallback(finish);
            request.onblocked = () => this.initFallback(finish);
            setTimeout(() => { if (!completed) this.initFallback(finish); }, 4000);
          } catch {
            this.initFallback(finish);
          }
        });
      },

      initFallback(finish) {
        try {
          const testKey = "__wv_test__";
          localStorage.setItem(testKey, "1");
          localStorage.removeItem(testKey);
          finish(true, "LocalStorage");
        } catch {
          finish(true, "Память (без сохранения)");
        }
      },

      async get(key) {
        if (this.driver === "IndexedDB" && this.db) {
          return new Promise(resolve => {
            try {
              const tx = this.db.transaction("app_state", "readonly");
              const req = tx.objectStore("app_state").get(key);
              req.onsuccess = () => resolve(req.result ?? null);
              req.onerror = () => resolve(null);
            } catch {
              resolve(null);
            }
          });
        }

        if (this.driver === "LocalStorage") {
          try {
            const val = localStorage.getItem("wv_" + key);
            return val ? JSON.parse(val) : null;
          } catch {
            return null;
          }
        }

        return this.memoryStore.get(key) ?? null;
      },

      put(key, value) {
        const snapshot = clone(value);
        const op = () => new Promise(resolve => {
          if (this.driver === "IndexedDB" && this.db) {
            try {
              const tx = this.db.transaction("app_state", "readwrite");
              tx.objectStore("app_state").put(snapshot, key);
              tx.oncomplete = () => resolve(true);
              tx.onerror = tx.onabort = () => resolve(false);
              return;
            } catch {}
          }

          if (this.driver === "LocalStorage" || !this.db) {
            try {
              localStorage.setItem("wv_" + key, JSON.stringify(snapshot));
              resolve(true);
              return;
            } catch {}
          }

          this.memoryStore.set(key, snapshot);
          resolve(false);
        });

        this.queue = this.queue.then(op, op);
        return this.queue;
      }
    };

    const Sound = {
      ctx: null,
      muted: true,
      unlocked: false,

      unlock() {
        if (this.unlocked && this.ctx && this.ctx.state === "running") return;
        try {
          const AudioClass = window.AudioContext || window.webkitAudioContext;
          if (!AudioClass) return;
          if (!this.ctx) this.ctx = new AudioClass();
          if (this.ctx.state === "suspended") {
            this.ctx.resume().catch(() => {});
          }
          this.unlocked = true;
        } catch {}
      },

      play(success = false) {
        if (this.muted) return;
        this.unlock();

        try {
          if (!this.ctx) return;
          const notes = success ? [523, 659, 784] : [540];
          const time = this.ctx.currentTime;

          notes.forEach((frequency, index) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const start = time + index * .07;

            osc.type = "sine";
            osc.frequency.value = frequency;
            gain.gain.setValueAtTime(.07, start);
            gain.gain.exponentialRampToValueAtTime(.001, start + .18);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(start);
            osc.stop(start + .2);
          });
        } catch {}
      }
    };

    ["pointerdown", "touchstart", "click", "keydown"].forEach(evt => {
      window.addEventListener(evt, () => Sound.unlock(), { once: true, passive: true });
    });

    let wakeLockSentinel = null;
    async function updateWakeLock(enable) {
      if (!("wakeLock" in navigator)) return;
      try {
        if (enable && !wakeLockSentinel && !document.hidden) {
          wakeLockSentinel = await navigator.wakeLock.request("screen");
          wakeLockSentinel.addEventListener("release", () => {
            wakeLockSentinel = null;
          });
        } else if (!enable && wakeLockSentinel) {
          await wakeLockSentinel.release();
          wakeLockSentinel = null;
        }
      } catch {}
    }

    let deviceId = uid();
    let logicalClock = 0;
    let activeTab = "constructor";
    let activeBookId = null;
    let activeBookTopicIndex = null;
    // The persisted state.board is always the standalone draft.
    // Book grids are edited through a separate transient entity.
    let bookEditorBoard = null;
    let editorSession = 0;
    let generationRequest = 0;

    function isBookEditor() {
      return bookEditorBoard !== null && activeBookId !== null && activeBookTopicIndex !== null;
    }

    function currentBoardEntity() {
      return isBookEditor() ? bookEditorBoard : state.board;
    }

    function leaveBookEditor() {
      if (bookEditorBoard !== null || activeBookTopicIndex !== null) {
        editorSession++;
        generationRequest++;
      }
      bookEditorBoard = null;
      activeBookTopicIndex = null;
      $("generateButton").disabled = false;
      $("generationStatus").textContent = "";
      updateBookContextBanner();
    }

    let state = {
      schema: SCHEMA,
      freeBoardIsolated: true,
      board: { rev: { n: 0, by: "" }, ancestors: [], value: emptyBoard() },
      topics: {},
      books: {},
      game: null
    };

    let showAnswers = false;
    let focusedWord = null;
    let textModified = false;
    let savedAt = 0;

    function cleanSettings(value = {}) {
      return {
        h: typeof value.h === "boolean" ? value.h : true,
        v: typeof value.v === "boolean" ? value.v : true,
        d: typeof value.d === "boolean" ? value.d : true,
        reverse: typeof value.reverse === "boolean" ? value.reverse : true,
        filler: ["freq", "uniform", "dots"].includes(value.filler) ? value.filler : "freq",
        overlap: typeof value.overlap === "boolean" ? value.overlap : true
      };
    }

    function allowedDirections(settings) {
      const result = [];
      if (settings.h) result.push([0, 1]);
      if (settings.v) result.push([1, 0]);
      if (settings.d) result.push([1, 1], [1, -1]);

      if (settings.reverse) {
        if (settings.h) result.push([0, -1]);
        if (settings.v) result.push([-1, 0]);
        if (settings.d) result.push([-1, -1], [-1, 1]);
      }
      return result;
    }

    function emptyBoard() {
      return {
        id: "empty",
        name: "Новая тема",
        raw: "",
        words: [],
        settings: clone(DEFAULT_SETTINGS),
        grid: Array(CELLS).fill("·"),
        placements: [],
        createdAt: 0
      };
    }

    function findOccurrences(grid, word, mismatchLimit = 0, limit = 1000) {
      const found = [];
      const seen = new Set();

      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          for (const [dr, dc] of ALL_DIRS) {
            const endR = r + dr * (word.length - 1);
            const endC = c + dc * (word.length - 1);
            if (endR < 0 || endR >= SIZE || endC < 0 || endC >= SIZE) continue;

            const cells = [];
            const errors = [];

            for (let k = 0; k < word.length; k++) {
              const index = (r + dr * k) * SIZE + c + dc * k;
              cells.push(index);
              if (grid[index] !== word[k]) {
                errors.push({ index, actual: grid[index], expected: word[k] });
              }
              if (errors.length > mismatchLimit) break;
            }

            if (cells.length !== word.length || errors.length !== mismatchLimit) continue;

            const forward = cells.join(",");
            const backward = [...cells].reverse().join(",");
            const key = word === [...word].reverse().join("")
              ? [forward, backward].sort()[0]
              : forward;

            if (seen.has(key)) continue;
            seen.add(key);
            found.push({ cells, errors });
            if (found.length >= limit) return found;
          }
        }
      }
      return found;
    }

    function placementsFromGrid(grid, words) {
      const placements = [];
      for (const word of words) {
        const found = findOccurrences(grid, word, 0, 1);
        if (found.length) placements.push({ word, cells: found[0].cells });
      }
      return placements;
    }

    function validCells(cells, word, grid) {
      if (!Array.isArray(cells) || cells.length !== word.length) return false;
      if (!cells.every(i => Number.isInteger(i) && i >= 0 && i < CELLS)) return false;
      if (new Set(cells).size !== cells.length) return false;
      if (cells.map(i => grid[i]).join("") !== word) return false;

      const dr = Math.floor(cells[1] / SIZE) - Math.floor(cells[0] / SIZE);
      const dc = cells[1] % SIZE - cells[0] % SIZE;

      if (!ALL_DIRS.some(d => d[0] === dr && d[1] === dc)) return false;

      return cells.every((index, k) =>
        Math.floor(index / SIZE) === Math.floor(cells[0] / SIZE) + dr * k &&
        index % SIZE === cells[0] % SIZE + dc * k
      );
    }

    function validateBoard(value) {
      if (!value || typeof value !== "object") throw new Error("Нет данных сетки");
      if (!Array.isArray(value.grid)) throw new Error("Неверная матрица");

      const grid = value.grid.flat();
      if (grid.length !== CELLS || !grid.every(x =>
        typeof x === "string" && /^[А-ЯA-Z·]$/.test(x)
      )) throw new Error("Матрица должна содержать 225 допустимых символов");

      if (!Array.isArray(value.words) || value.words.length > MAX_WORDS ||
          !value.words.every(w => typeof w === "string" && /^[А-ЯA-Z]{2,15}$/.test(w))) {
        throw new Error("Неверный список слов");
      }

      const words = [...new Set(value.words)];
      if (!Array.isArray(value.placements) || value.placements.length > MAX_WORDS) {
        throw new Error("Неверный список размещений");
      }

      const used = new Set();
      const placements = value.placements.map(p => {
        if (!p || !words.includes(p.word) || used.has(p.word) ||
            !validCells(p.cells, p.word, grid)) {
          throw new Error("Ответы не соответствуют буквам сетки");
        }
        used.add(p.word);
        return { word: p.word, cells: [...p.cells] };
      });

      return {
        id: String(value.id || "imported").slice(0, 160),
        name: String(value.name || "Новая тема").slice(0, 120),
        raw: typeof value.raw === "string" ? value.raw.slice(0, 30000) : words.join(", "),
        words,
        settings: cleanSettings(value.settings),
        grid: [...grid],
        placements,
        createdAt: Number.isFinite(value.createdAt) ? value.createdAt : 0
      };
    }

    function weightedLetter(table) {
      const total = table.reduce((sum, item) => sum + item[1], 0);
      let value = Math.random() * total;
      for (const [letter, weight] of table) {
        value -= weight;
        if (value <= 0) return letter;
      }
      return table[table.length - 1][0];
    }

    function randomFiller(words, mode) {
      if (mode === "dots") return "·";
      const all = words.join("");
      const ru = (all.match(/[А-Я]/g) || []).length;
      const en = (all.match(/[A-Z]/g) || []).length;
      const useEnglish = en > 0 && Math.random() < en / Math.max(1, ru + en);

      if (mode === "freq") return weightedLetter(useEnglish ? EN_WEIGHTS : RU_WEIGHTS);

      const alphabet = useEnglish
        ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        : "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ";

      return alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    async function generateGrid(words, settings, cancelled = () => false) {
      if (!words.length) return { grid: Array(CELLS).fill("·"), placements: [] };

      const directions = allowedDirections(settings);
      if (!directions.length) throw new Error("Выберите хотя бы одно основное направление");

      let best = null;
      let bestScore = -1;
      const startTime = performance.now();
      const budgetMs = 380;
      let iteration = 0;
      const maxIterations = 80;

      while ((performance.now() - startTime < budgetMs || iteration < 8) && iteration < maxIterations) {
        iteration++;
        if (cancelled()) return null;

        const grid = Array(CELLS).fill("");
        const placements = [];

        const shuffled = words.map(w => ({ word: w, score: w.length + (Math.random() * 0.9 - 0.45) }))
          .sort((a, b) => b.score - a.score)
          .map(x => x.word);

        for (let wi = 0; wi < shuffled.length; wi++) {
          const word = shuffled[wi];
          let choice = null;
          let topScore = -Infinity;

          for (const [dr, dc] of directions) {
            for (let r = 0; r < SIZE; r++) {
              for (let c = 0; c < SIZE; c++) {
                const er = r + dr * (word.length - 1);
                const ec = c + dc * (word.length - 1);
                if (er < 0 || er >= SIZE || ec < 0 || ec >= SIZE) continue;

                const cells = [];
                let overlap = 0;
                let valid = true;

                for (let k = 0; k < word.length; k++) {
                  const i = (r + dr * k) * SIZE + c + dc * k;
                  if (!settings.overlap && grid[i]) { valid = false; break; }
                  if (grid[i] && grid[i] !== word[k]) { valid = false; break; }
                  if (grid[i]) overlap++;
                  cells.push(i);
                }

                if (!valid) continue;

                const score = settings.overlap
                  ? overlap * (iteration % 2 ? 2.5 : 4.0) + Math.random() * 3.5
                  : Math.random() * 10;
                if (score > topScore) {
                  topScore = score;
                  choice = cells;
                }
              }
            }
          }

          if (choice) {
            choice.forEach((index, k) => { grid[index] = word[k]; });
            placements.push({ word, cells: choice });
          }
        }

        const occupied = grid.filter(Boolean).length;
        const lettersPlaced = placements.reduce((sum, p) => sum + p.word.length, 0);
        const score = placements.length * 100000 + lettersPlaced * 100 + occupied;

        if (score > bestScore) {
          bestScore = score;
          best = { grid, placements };
        }

        if (placements.length === words.length && iteration >= 3) break;

        if (iteration % 6 === 0) {
          await sleep(0);
          if (cancelled()) return null;
        }
      }

      if (!best) {
        best = { grid: Array(CELLS).fill(""), placements: [] };
      }

      best.grid = best.grid.map(letter => letter || randomFiller(words, settings.filler));
      return best;
    }

    const revKey = rev => `${rev.n}@${rev.by}`;

    function compareRev(a, b) {
      if (a.n !== b.n) return a.n > b.n ? 1 : -1;
      return a.by === b.by ? 0 : (a.by > b.by ? 1 : -1);
    }

    function nextRevision() {
      logicalClock++;
      return { n: logicalClock, by: deviceId };
    }

    function observe(entity) {
      if (entity?.rev) logicalClock = Math.max(logicalClock, entity.rev.n);
    }

    function validRev(rev) {
      return rev && Number.isSafeInteger(rev.n) && rev.n >= 0 &&
        typeof rev.by === "string" && rev.by.length <= 100;
    }

    function entityFrom(base, value) {
      return {
        rev: nextRevision(),
        ancestors: [...new Set([
          revKey(base.rev), ...(base.ancestors || [])
        ])].slice(0, 64),
        value
      };
    }

    function validateState(raw) {
      if (!raw || (raw.schema !== 3 && raw.schema !== SCHEMA) || !raw.board || !validRev(raw.board.rev)) {
        throw new Error("Неподдерживаемая версия состояния");
      }

      const ancestors = Array.isArray(raw.board.ancestors)
        ? raw.board.ancestors.filter(x => typeof x === "string").slice(0, 64)
        : [];

      const topics = {};
      const entries = Object.entries(raw.topics || {});
      for (const [id, record] of entries) {
        if (id.length > 220 || !record || !validRev(record.rev)) continue;
        if (["__proto__", "prototype", "constructor"].includes(id)) continue;

        if (record.deleted === true) {
          topics[id] = { rev: clone(record.rev), deleted: true };
          continue;
        }

        const value = record.value;
        if (!value || typeof value.name !== "string" || !Array.isArray(value.words)) continue;

        topics[id] = {
          rev: clone(record.rev),
          deleted: false,
          value: {
            name: value.name.slice(0, 160),
            words: [...new Set(value.words)],
            board: value.board ? validateBoard(value.board) : null,
            updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
            conflict: value.conflict === true
          }
        };
      }

      const books = {};
      const bookEntries = Object.entries(raw.books || {});
      for (const [id, book] of bookEntries) {
        if (["__proto__", "prototype", "constructor"].includes(id)) continue;
        if (!book || typeof book.title !== "string" || !Array.isArray(book.topics)) continue;
        books[id] = {
          id: String(book.id || id),
          title: String(book.title || "Сборник филвордов").slice(0, 120),
          author: String(book.author || "WordVault").slice(0, 100),
          settings: cleanSettings(book.settings),
          topics: (book.topics || []).map(t => ({
            id: String(t.id || uid()),
            name: String(t.name || "Тема").slice(0, 120),
            raw: typeof t.raw === "string" ? t.raw.slice(0, 30000) : "",
            words: Array.isArray(t.words) ? [...t.words] : parseWords(t.raw || "").words,
            grid: Array.isArray(t.grid) && t.grid.length === CELLS ? [...t.grid] : null,
            placements: Array.isArray(t.placements) ? clone(t.placements) : [],
            settings: t.settings ? cleanSettings(t.settings) : undefined
          })),
          updatedAt: Number.isFinite(book.updatedAt) ? book.updatedAt : Date.now()
        };
      }

      const freeBoard = {
        rev: clone(raw.board.rev),
        ancestors,
        value: validateBoard(raw.board.value)
      };

      // Older versions copied an opened book topic into the shared board.
      // If the legacy board is an exact duplicate, keep the book data and
      // start a fresh independent draft. Never reset an unrelated draft.
      if (raw.freeBoardIsolated !== true) {
        const candidate = freeBoard.value;
        const duplicateBookTopic = Object.values(books).some(book => book.topics.some(topic =>
          topic.grid && topic.name === candidate.name &&
          topic.raw === candidate.raw &&
          stable(topic.words) === stable(candidate.words) &&
          stable(topic.grid) === stable(candidate.grid) &&
          stable(topic.placements) === stable(candidate.placements)
        ));
        if (duplicateBookTopic) freeBoard.value = emptyBoard();
      }

      return {
        schema: SCHEMA,
        freeBoardIsolated: true,
        board: freeBoard,
        topics,
        books,
        game: raw.game && raw.game.board ? { board: validateBoard(raw.game.board), found: raw.game.found || {}, elapsedMs: Math.max(0, Number(raw.game.elapsedMs) || 0), manualPaused: !!raw.game.manualPaused, completed: !!raw.game.completed } : null
      };
    }

    function liveTopics() {
      return Object.entries(state.topics).filter(([, record]) => !record.deleted);
    }

    async function persistState() {
      const snapshot = clone(state);
      const ok = await DB.put("wv_firebase_local_v1", {state: snapshot, base: Sync.base, ack: Sync.ack, owner: Sync.owner});
      if (ok) {
        savedAt = Date.now();
        $("storageStatus").textContent =
          `Сохранено на устройстве · ` + new Date(savedAt).toLocaleTimeString();
      } else {
        $("storageStatus").textContent =
          "Не удалось записать локальную базу. Сохраните резервную копию JSON.";
      }
      updateSyncDialog();
      return ok;
    }

    function stateChanged() {
      persistState();
      Sync.queuePush();
      renderTopics();
      renderBooks();
      updateGameNewBoard();
    }

    function commitBoard(board, base = currentBoardEntity()) {
      rememberBoard(currentBoardEntity().value, board, "Изменение сетки");
      observe(base);
      const next = entityFrom(base, board);
      if (isBookEditor()) {
        const book = state.books[activeBookId];
        const topic = book?.topics[activeBookTopicIndex];
        if (!topic) return;
        bookEditorBoard = next;
        topic.name = board.name;
        topic.raw = board.raw;
        topic.words = [...board.words];
        topic.grid = [...board.grid];
        topic.placements = clone(board.placements);
        topic.settings = clone(board.settings);
        book.updatedAt = Date.now();
      } else {
        state.board = next;
      }
      focusedWord = null;
      textModified = false;
      $("rebuildHint").hidden = true;
      renderConstructor(true);
      stateChanged();
    }

    function updateBookContextBanner() {
      $("freeContextBanner").hidden = isBookEditor();
      if (isBookEditor()) {
        const book = state.books[activeBookId];
        if (book && book.topics[activeBookTopicIndex]) {
          const t = book.topics[activeBookTopicIndex];
          $("bookContextBanner").hidden = false;
          $("bannerBookTitle").textContent = book.title;
          $("bannerTopicTitle").textContent = t.name;
          $("bannerTopicPos").textContent = `#${activeBookTopicIndex + 1} из ${book.topics.length}`;
          $("prevBookTopicBtn").disabled = activeBookTopicIndex <= 0;
          $("nextBookTopicBtn").disabled = activeBookTopicIndex >= book.topics.length - 1;
          return;
        }
      }
      $("bookContextBanner").hidden = true;
    }

    const FIREBASE_CONFIG = {
      apiKey: "AIzaSyBtjN9G8Rqmm2gfbYQ3kpGzo6VXq8Bomvo",
      authDomain: "wordvault-e765c.firebaseapp.com",
      projectId: "wordvault-e765c",
      storageBucket: "wordvault-e765c.firebasestorage.app",
      messagingSenderId: "676306809324",
      appId: "1:676306809324:web:0ca30696392e2454ffd0c9"
    };
    const OWNER_UID = "EWc3OwcvPdWIEBJxhwwZfAxwz8i2";
    const Cloud = {
      db: null, auth: null, starting: null, cache: null,
      async setup() {
        if (this.starting) return this.starting;
        if (!window.firebase?.auth || !window.firebase?.firestore) throw new Error('Не загрузились библиотеки Firebase. Проверьте интернет и обновите страницу.');
        this.starting = (async () => {
          const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
          this.auth = app.auth(); this.db = app.firestore();
          await this.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
          await new Promise((resolve, reject) => {
            const stop = this.auth.onAuthStateChanged(() => { stop(); resolve(); }, reject);
          });
        })().catch(error => { this.starting = null; throw error; });
        return this.starting;
      },
      bindUser(user) {
        if (!user || user.uid !== OWNER_UID) throw new Error('Войдите в аккаунт владельца WordVault.');
        const owner = FIREBASE_CONFIG.projectId + ':' + user.uid;
        if (Sync.owner && Sync.owner !== owner) throw new Error('Локальные данные принадлежат другому аккаунту. Сохраните резервную копию и используйте другой профиль браузера.');
        Sync.owner = owner;
        Sync.channel = user.email || 'Мой WordVault';
        $('cloudAccount').textContent = user.email || 'Вход выполнен';
        $('cloudSignOut').hidden = false;
        $('cloudLoginForm').hidden = true;
      },
      async session() {
        await this.setup();
        if (!this.auth.currentUser) {
          $('cloudLoginForm').hidden = false;
          $('cloudSignOut').hidden = true;
          $('cloudAccount').textContent = 'Войдите для синхронизации';
          throw new Error('Откройте окно синхронизации и войдите с вашим email и паролем.');
        }
        this.bindUser(this.auth.currentUser);
      },
      async login(event) {
        event.preventDefault();
        if (Sync.busy) { toast('Подождите завершения подключения и нажмите «Войти» ещё раз.'); return; }
        $('cloudLoginBtn').disabled = true;
        try {
          await this.setup();
          const result = await this.auth.signInWithEmailAndPassword($('cloudEmail').value.trim(), $('cloudPassword').value);
          $('cloudPassword').value = '';
          if (result.user.uid !== OWNER_UID) { await this.auth.signOut(); throw new Error('Этот аккаунт не является владельцем WordVault.'); }
          this.bindUser(result.user);
          await persistState();
          await Sync.push();
        } catch (error) { $('syncError').textContent = this.errorText(error); }
        finally { $('cloudPassword').value = ''; $('cloudLoginBtn').disabled = false; }
      },
      async logout() {
        if (Sync.busy) { toast('Дождитесь завершения синхронизации.'); return; }
        if (Sync.dirty()) { toast('Сначала синхронизируйте изменения.'); return; }
        try {
          await this.auth.signOut(); this.cache = null;
          $('cloudLoginForm').hidden = false; $('cloudSignOut').hidden = true;
          $('cloudAccount').textContent = 'Вход не выполнен';
          Sync.connected = false; Sync.update('Локально · войдите в облако', 'offline');
        } catch (error) { $('syncError').textContent = this.errorText(error); }
      },
      errorText(error) {
        const messages = {
          'permission-denied':'Нет доступа к базе. Проверьте правила Firestore и нажмите Publish после их вставки.',
          'resource-exhausted':'Достигнут лимит Firebase. Локальные изменения сохранены; повторите синхронизацию позже.',
          'unavailable':'Нет соединения с Firebase. Локальные изменения остаются на устройстве.',
          'auth/invalid-credential':'Неверный email или пароль.',
          'auth/wrong-password':'Неверный email или пароль.',
          'auth/user-not-found':'Неверный email или пароль.',
          'auth/operation-not-allowed':'В Firebase нужно включить Authentication → Email/Password.',
          'auth/network-request-failed':'Не удалось связаться с Firebase. Проверьте соединение.',
          'auth/too-many-requests':'Слишком много попыток входа. Попробуйте позже.'
        };
        return messages[error.code] || error.message || 'Ошибка синхронизации';
      },
      root() { return this.db.doc('users/' + OWNER_UID + '/sync/current'); },
      part(i) { return this.root().collection('parts').doc(String(i)); },
      metadata(snapshot) {
        if (!snapshot.exists) return {revision:0, count:0};
        const meta = snapshot.data();
        if (!Number.isSafeInteger(meta.revision) || meta.revision < 1 || !Number.isInteger(meta.count) || meta.count < 1 || meta.count > 32) throw new Error('Повреждены сведения облачной версии. Сохраните локальную резервную копию.');
        return meta;
      },
      async readParts(tx, meta) {
        if (!meta.revision) return {revision:0,state:null};
        const parts = await Promise.all(Array.from({length:meta.count}, (_,i) => tx.get(this.part(i))));
        const payload = parts.map(part => {
          const data = part.data();
          if (!part.exists || data?.revision !== meta.revision || typeof data?.text !== 'string') throw new Error('Неполная облачная версия. Локальные данные не изменены.');
          return data.text;
        }).join('');
        return {revision:meta.revision,state:JSON.parse(payload),savedAt:meta.savedAt};
      },
      async request(method, body) {
        await this.session();
        if (method === 'GET') {
          const meta = this.metadata(await this.root().get({source:'server'}));
          if (this.cache?.revision === meta.revision) return {status:200,data:clone(this.cache)};
          const data = await this.db.runTransaction(async tx => {
            const current = this.metadata(await tx.get(this.root()));
            return this.readParts(tx, current);
          });
          this.cache = clone(data);
          return {status:200,data};
        }
        const payload = JSON.stringify(body.state);
        if (new TextEncoder().encode(payload).length > 4 * 1024 * 1024) throw new Error('Рабочая база превышает 4 МБ для одной синхронизации. Сохраните JSON и разделите сборники. Локальная копия не удалена.');
        // Each part remains safely under Firestore's 1 MiB document limit.
        const parts = [];
        for (let i=0;i<payload.length;) {
          let end = Math.min(i+180000,payload.length);
          if (end<payload.length && /[\uD800-\uDBFF]/.test(payload[end-1])) end--;
          parts.push(payload.slice(i,end)); i=end;
        }
        if (parts.length > 32) throw new Error('Слишком много частей данных для синхронизации.');
        const result = await this.db.runTransaction(async tx => {
          const meta = this.metadata(await tx.get(this.root()));
          if (meta.revision !== body.base) return {status:409,data:await this.readParts(tx,meta)};
          const revision = meta.revision + 1;
          const savedAt = Date.now();
          parts.forEach((text,i) => tx.set(this.part(i),{revision,text}));
          for (let i=parts.length;i<meta.count;i++) tx.delete(this.part(i));
          tx.set(this.root(),{revision,count:parts.length,savedAt});
          return {status:200,data:{revision,savedAt}};
        });
        if (result.status === 200) this.cache = { ...result.data, state:clone(body.state) };
        else this.cache = clone(result.data);
        return result;
      }
    };

    const Sync = {
      connected: false, ready: false, timer: null, busy: false, conflict: null,
      channel: 'Личная база · Firebase', base: 0, ack: null, owner: null,
      async init(local) {
        this.owner = local?.owner || null;
        this.base = local?.base || 0;
        this.ack = local?.ack ? stable(validateState(JSON.parse(local.ack))) : null;
        this.ready = true;
        $('cloudLoginForm').onsubmit = e => Cloud.login(e);
        $('cloudSignOut').onclick = () => Cloud.logout();
        $('syncUseCloud').onclick = () => this.resolve('cloud');
        $('syncUseLocal').onclick = () => this.resolve('local');
        $('syncConflictBackup').onclick = () => exportBackup();
        $('syncCloudBackup').onclick = () => {
          if (this.conflict) download(JSON.stringify({format:'WordVaultBackup',version:SCHEMA,state:this.conflict.state},null,2),'WordVault_Cloud.json','application/json');
        };
        window.addEventListener('online', () => this.push());
        window.addEventListener('focus', () => this.push());
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) { pauseGameClock(); saveGame(); }
          else { this.push(); refreshGameClock(); }
        });
        window.addEventListener('beforeunload', e => {
          if (this.owner && this.dirty()) { e.preventDefault(); e.returnValue = ''; }
        });
        setInterval(() => { if (!document.hidden) this.push(); }, 15000);
        await this.push();
      },
      dirty() {
        if (this.ack !== null) return stable(state) !== this.ack;
        return !!(state.board.value.raw || state.board.value.words.length || Object.keys(state.books).length || Object.keys(state.topics).length || state.game);
      },
      update(text, cls = '') {
        $('syncButton').textContent = text;
        $('syncButton').className = 'sync-badge ' + cls;
        updateSyncDialog();
      },
      queuePush(delay = 600) {
        if (!this.ready) return;
        clearTimeout(this.timer);
        this.update('Есть изменения · сохраняем…');
        this.timer = setTimeout(() => this.push(), delay);
      },
      showConflict(remote) {
        this.conflict = remote;
        this.update('Две версии · выберите', 'offline');
        if (!$('syncConflict').open) $('syncConflict').showModal();
      },
      apply(remote) {
        state = validateState(remote.state);
        observe(state.board);
        this.base = remote.revision;
        this.ack = stable(state);
        leaveBookEditor();
        activeBookId = null;
        pauseGameClock(); game = state.game ? clone(state.game) : null;
        renderConstructor(true); updateInputWarnings(); renderTopics(); renderBooks();
        $('bookDetailView').hidden = true; $('booksListView').hidden = false;
        updateBookContextBanner(); updateGameNewBoard();
        if (activeTab === 'play') { if (game) { renderGame(); refreshGameClock(); } else switchTab('constructor'); }
      },
      async resolve(choice) {
        const remote = this.conflict;
        if (!remote || this.busy) return;
        // Preserve the local alternative before replacing anything.
        if (!await DB.put('wv_sync_recovery', { state: clone(state), cloud: remote, savedAt: Date.now() })) {
          toast('Не удалось сохранить страховочную копию. Скачайте JSON перед выбором версии.'); return;
        }
        if (choice === 'cloud') this.apply(remote);
        else { this.base = remote.revision; this.ack = stable(validateState(remote.state)); }
        this.conflict = null;
        $('syncConflict').close();
        await persistState();
        await this.push();
      },
      async request(method, body) { return Cloud.request(method, body); },
      async push() {
        if (!this.ready || this.busy) return;
        if (this.conflict) { this.showConflict(this.conflict); return; }
        this.busy = true;
        try {
          this.update('Синхронизация…');
          const {data: remote} = await this.request('GET');
          this.connected = true;
          $('syncError').textContent = '';

          if (remote.state) {
            remote.state = validateState(remote.state);
            const remoteText = stable(remote.state);
            if (remoteText === stable(state)) { this.base = remote.revision; this.ack = remoteText; }
            else if (remote.revision !== this.base) {
              if (this.dirty()) { this.showConflict(remote); return; }
              this.apply(remote);
            }
          } else if (this.base !== 0) {
            throw new Error('Облачная версия недоступна. Локальная копия сохранена.');
          }
          if (this.dirty()) {
            state = validateState(state);
            const sent = stable(state);
            const result = await this.request('PUT', {base: this.base, state: JSON.parse(sent)});
            if (result.status === 409) { this.showConflict(result.data); return; }
            this.base = result.data.revision;
            this.ack = sent;
          } else if (!remote.state) {
            this.ack = stable(state);
          }
          await persistState();
          this.update(this.dirty() ? 'Есть изменения · сохраняем…' : 'Облако: сохранено ', 'online');
        } catch (error) {
          this.connected = false;
          this.update(navigator.onLine ? 'Не синхронизировано · повторим' : 'Офлайн · локальная копия', 'offline');
          $('syncError').textContent = Cloud.errorText(error);
        } finally {
          this.busy = false;
          if (!this.conflict && this.connected && this.dirty()) this.queuePush(100);
        }
      }
    };

    function updateSyncDialog() {
      $("syncChannel").textContent = Sync.channel || "—";
      $("syncConnection").textContent = Sync.connected ? "подключено" : "нет соединения";
      $("syncStorage").textContent = `${DB.driver} (${DB.ok ? "активно" : "ошибка"})`;
    }

    function settingsFromUI() {
      return {
        h: $("dirH").checked,
        v: $("dirV").checked,
        d: $("dirD").checked,
        reverse: $("dirR").checked,
        filler: $("fillerMode").value,
        overlap: $("allowOverlap").checked
      };
    }

    function updateInputWarnings() {
      const parsed = parseWords($("wordsInput").value);
      $("wordCount").textContent = `${parsed.words.length} слов`;

      const warnings = [];
      if (parsed.rejected.length) {
        warnings.push("Не добавлены: " + parsed.rejected.slice(0, 8).join("; ") +
          (parsed.rejected.length > 8 ? " …" : ""));
      }
      if (parsed.duplicates) warnings.push(`Повторов исключено: ${parsed.duplicates}.`);

      $("wordWarnings").hidden = warnings.length === 0;
      $("wordWarnings").textContent = warnings.join(" ");

      const currentWords = currentBoardEntity().value.words;
      const isWordsChanged = stable(parsed.words) !== stable(currentWords);
      textModified = isWordsChanged;
      $("rebuildHint").hidden = !isWordsChanged;
    }

    function autoSaveMetaOnly() {
      const before = clone(currentBoardEntity().value);
      const name = $("topicName").value.trim().slice(0, 120) || "Новая тема";
      if (name !== currentBoardEntity().value.name || $("wordsInput").value.slice(0, 30000) !== currentBoardEntity().value.raw) {
        generationRequest++; // Cancel generation started with now-outdated text.
        $("generateButton").disabled = false;
        $("generationStatus").textContent = "";
        currentBoardEntity().value.name = name;
        currentBoardEntity().value.raw = $("wordsInput").value.slice(0, 30000);
        if (isBookEditor()) {
          const b = state.books[activeBookId];
          if (b && b.topics[activeBookTopicIndex]) {
            b.topics[activeBookTopicIndex].name = name;
            b.topics[activeBookTopicIndex].raw = $("wordsInput").value;
            b.updatedAt = Date.now();
            updateBookContextBanner();
          }
        }
        rememberBoard(before,currentBoardEntity().value,"Текст темы",true);
        stateChanged();
        renderStudio();
      }
    }

    async function executeRebuild() {
      const raw = $("wordsInput").value.slice(0, 30000);
      const parsed = parseWords(raw);
      const name = $("topicName").value.trim().slice(0, 120) || "Новая тема";
      const settings = settingsFromUI();

      if (!parsed.words.length) {
        toast("Введите слова для построения сетки.");
        return;
      }

      const request = ++generationRequest;
      const session = editorSession;
      $("generateButton").disabled = true;
      $("generationStatus").textContent = "Поиск оптимальной укладки…";

      try {
        const layout = await generateGrid(parsed.words, settings,
          () => request !== generationRequest || session !== editorSession);
        if (!layout || request !== generationRequest || session !== editorSession) return;
        const base = clone(currentBoardEntity());

        const board = {
          id: uid(),
          name,
          raw,
          words: parsed.words,
          settings,
          grid: layout.grid,
          placements: layout.placements,
          createdAt: Date.now()
        };

        commitBoard(board, base);
        setMobilePanel("grid");
        $("generationStatus").textContent =
          `Готово: размещено ${board.placements.length} из ${board.words.length}.`;
      } catch (error) {
        if (request === generationRequest && session === editorSession) {
          $("generationStatus").textContent = error.message;
          toast(error.message);
        }
      } finally {
        if (request === generationRequest) $("generateButton").disabled = false;
      }
    }

    function createGrid(container, grid, onClick) {
      container.replaceChildren();
      grid.forEach((letter, index) => {
        const cell = node("div", "cell", letter);
        cell.dataset.index = index;
        cell.title = `${coord(index)}: ${letter}`;
        if (onClick) cell.addEventListener("click", () => onClick(index));
        container.append(cell);
      });
    }

    function renderConstructor(updateInputs = false) {
      const board = currentBoardEntity().value;

      if (updateInputs) {
        $("topicName").value = board.name;
        $("wordsInput").value = board.raw;
        $("dirH").checked = board.settings.h;
        $("dirV").checked = board.settings.v;
        $("dirD").checked = board.settings.d;
        $("dirR").checked = board.settings.reverse;
        $("fillerMode").value = board.settings.filler;
        $("allowOverlap").checked = board.settings.overlap !== false;
        updateInputWarnings();
        updateBookContextBanner();
      }

      createGrid($("constructorGrid"), board.grid, index => {
        const matching = board.placements.filter(p => p.cells.includes(index));
        const current = matching.findIndex(p => p.word === focusedWord);
        focusedWord = !matching.length ? null
          : current < matching.length - 1 ? matching[current + 1].word : null;
        renderConstructor();
      });

      const occupied = new Set();
      board.placements.forEach((placement, colorIndex) => {
        const color = COLORS[colorIndex % COLORS.length];
        placement.cells.forEach(index => {
          occupied.add(index);
          const cell = $("constructorGrid").children[index];
          if (!cell) return;
          if (placement.word === focusedWord) {
            cell.style.setProperty("--word-color", color);
            cell.classList.add("highlight");
          } else if (showAnswers && !cell.classList.contains("highlight")) {
            if (!cell.classList.contains("answer")) cell.style.setProperty("--word-color", color);
            cell.classList.add("answer");
          }
        });
      });

      $("boardStats").textContent =
        `${board.placements.length} слов · ${occupied.size} букв · ${Math.round(occupied.size / CELLS * 100)}% занято`;
      $("placedSummary").textContent = `${board.placements.length} из ${board.words.length}`;
      $("saveTopicButton").textContent = isBookEditor() ? "Копию в библиотеку" : "В библиотеку";
      $("revealButton").textContent = showAnswers ? " Подсветка: вкл" : "Подсветка: выкл";

      const chips = $("constructorWords");
      chips.replaceChildren();
      const placed = new Set(board.placements.map(p => p.word));

      board.words.forEach(word => {
        const found = placed.has(word);
        const chip = action((found ? "" : " ") + word, () => {
          if (!found) { toast("Слово не размещено. Нажмите «Перестроить сетку»."); return; }
          focusedWord = focusedWord === word ? null : word;
          renderConstructor();
          Sound.play();
        }, "chip" + (!found ? " failed" : "") + (focusedWord === word ? " active" : ""));
        chips.append(chip);
      });

      if (!board.words.length) chips.append(node("span", "muted small-text", "Добавьте слова в панели «Слова» и создайте первую сетку."));
      renderStudio();
    }

    function renderBooks() {
      const books = Object.values(state.books || {});
      $("draftProjectTitle").textContent = state.board.value.name;
      $("draftProjectSummary").textContent = `${state.board.value.words.length} слов · независимый черновик`;
      $("navBooksCount").textContent = books.length;

      const container = $("booksGrid");
      container.replaceChildren();

      books.sort((a, b) => b.updatedAt - a.updatedAt).forEach(book => {
        const card = node("article", "card book-card");
        const cover = node("div", "book-cover");
        cover.append(node("span", "cover-number", "WORDVAULT / КНИГА"),node("h3", "", book.title));
        card.append(cover);
        card.append(node("span", "muted small-text", `Автор: ${book.author || "WordVault"}`));

        const totalTopics = book.topics.length;
        const generated = book.topics.filter(t => boardQuality({...t,grid:t.grid||[],settings:t.settings||book.settings}).ready).length;
        const totalWords = book.topics.reduce((acc, t) => acc + (t.words?.length || 0), 0);

        card.append(node("div", "badge", `${totalTopics} тем · ${totalWords} слов · готово: ${generated}/${totalTopics}`));

        const actions = node("div", "actions");
        actions.append(action(" Открыть книгу", () => openBook(book.id), "primary small"));
        actions.append(action("Удалить", async () => {
          const ok = await confirmModal(`Удалить книгу «${book.title}» (${totalTopics} тем)?`, "Удаление книги");
          if (!ok) return;
          delete state.books[book.id];
          if (activeBookId === book.id) activeBookId = null;
          await persistState();
          stateChanged();
        }, "danger small"));

        card.append(actions);
        container.append(card);
      });

      if (!books.length) {
        container.append(node("div", "card subtle muted", "Книг пока нет. Нажмите «+ Создать книгу», чтобы начать!"));
      }
    }

    function openBook(bookId) {
      activeBookId = bookId;
      const book = state.books[bookId];
      if (!book) return;

      $("booksListView").hidden = true;
      $("bookDetailView").hidden = false;
      renderBookDetail();
    }

    function renderBookDetail() {
      const book = state.books[activeBookId];
      if (!book) return;

      $("currentBookTitle").textContent = book.title;
      $("bookTopicsCount").textContent = book.topics.length;

      const total = book.topics.length;
      const ready = book.topics.filter(t => boardQuality({...t,grid:t.grid||[],settings:t.settings||book.settings}).ready).length;
      const pct = total === 0 ? 0 : Math.round((ready / total) * 100);

      $("currentBookProgressBadge").textContent = `${ready} / ${total} сеток готово (${pct}%)`;
      $("bookProgressBar").style.width = pct + "%";

      const tbody = $("bookTopicsTableBody");
      tbody.replaceChildren();

      book.topics.forEach((topic, idx) => {
        const tr = document.createElement("tr");

        const tdNum = node("td", "mono muted col-num", idx + 1);
        const tdName = node("td", "col-name", topic.name);
        const tdWords = node("td", "small-text muted col-words", topic.words.slice(0, 10).join(", ") + (topic.words.length > 10 ? "…" : ""));

        const placedCount = topic.placements?.length || 0;
        const totalCount = topic.words.length;
        const isReady = !StudioCore.needsGeneration(topic);
        const quality = boardQuality({...topic,grid:topic.grid||[],settings:topic.settings||book.settings});

        const tdStatus = node("td", "col-status");
        if (isReady) {
          const badgeClass = quality.ready ? "badge-green" : "badge-amber";
          tdStatus.append(node("span", `badge ${badgeClass}`, quality.ready ? `${placedCount}/${totalCount}` : "Проверить"));
        } else {
          tdStatus.append(node("span", "badge", "Не создана"));
        }

        const tdActions = node("td", "col-actions");
        const actionsDiv = node("div", "row", "");
        actionsDiv.style.justifyContent = "flex-end";

        actionsDiv.append(action(" Сетка", () => openTopicInConstructor(activeBookId, idx), "small primary"));

        actionsDiv.append(action("", async () => {
          const ok = await confirmModal(`Удалить тему «${topic.name}» из этой книги?`, "Удаление темы");
          if (!ok) return;

          const targetId = topic.id;
          const targetIndex = book.topics.findIndex(t => t.id === targetId);
          if (targetIndex !== -1) {
            book.topics.splice(targetIndex, 1);
            book.updatedAt = Date.now();
            await persistState();
            stateChanged();
            renderBookDetail();
            toast(`Тема «${topic.name}» удалена.`);
          }
        }, "small danger"));

        tdActions.append(actionsDiv);
        tr.append(tdNum, tdName, tdWords, tdStatus, tdActions);
        tbody.append(tr);
      });
    }

    function openTopicInConstructor(bookId, topicIndex) {
      const book = state.books[bookId];
      const topic = book?.topics[topicIndex];
      if (!topic) return;

      const session = ++editorSession;
      generationRequest++; // Stop any rebuild from a previously opened topic.
      activeBookId = bookId;
      activeBookTopicIndex = topicIndex;
      const board = {
        id: uid(),
        name: topic.name,
        raw: topic.raw || topic.words.join(", "),
        words: [...topic.words],
        settings: clone(topic.settings || book.settings),
        grid: topic.grid ? [...topic.grid] : Array(CELLS).fill("·"),
        placements: topic.placements ? clone(topic.placements) : [],
        createdAt: Date.now()
      };
      // Viewing a ready book grid never overwrites the free draft or
      // needlessly marks the book as changed in cloud synchronization.
      bookEditorBoard = { rev: clone(state.board.rev), ancestors: [], value: board };
      focusedWord = null;
      $("generationStatus").textContent = "";
      $("generateButton").disabled = false;
      switchTab("constructor", { bookEditor: true });
      renderConstructor(true);

      // Only never-generated topics auto-generate. Clearing a grid should
      // leave it cleared until the user explicitly rebuilds it.
      if (!topic.grid && board.words.length) {
        const request = ++generationRequest;
        $("generateButton").disabled = true;
        $("generationStatus").textContent = "Генерация сетки темы…";
        generateGrid(board.words, board.settings,
          () => session !== editorSession || request !== generationRequest)
          .then(layout => {
            if (!layout || session !== editorSession || request !== generationRequest || !isBookEditor()) return;
            board.grid = layout.grid;
            board.placements = layout.placements;
            commitBoard(board);
            $("generationStatus").textContent =
              `Готово: размещено ${board.placements.length} из ${board.words.length}.`;
          })
          .catch(err => {
            if (session !== editorSession || request !== generationRequest || !isBookEditor()) return;
            $("generationStatus").textContent = err.message;
            toast(err.message);
          })
          .finally(() => {
            if (session === editorSession && request === generationRequest) $("generateButton").disabled = false;
          });
      }
    }

    function addFastTopicToBook() {
      if (!activeBookId) return;
      const book = state.books[activeBookId];
      if (!book) return;

      const name = $("fastTopicName").value.trim() || `Тема ${book.topics.length + 1}`;
      const rawWords = $("fastTopicWords").value.trim();
      const parsed = parseWords(rawWords);

      if (!parsed.words.length) {
        toast("Введите слова для этой темы.");
        $("fastTopicWords").focus();
        return;
      }

      book.topics.push({
        id: uid(),
        name,
        raw: rawWords,
        words: parsed.words,
        grid: null,
        placements: [],
        found: []
      });

      book.updatedAt = Date.now();
      stateChanged();
      renderBookDetail();

      $("fastTopicName").value = "";
      $("fastTopicWords").value = "";
      $("fastTopicName").focus();
      toast(`Тема «${name}» добавлена (#${book.topics.length}).`);
    }

    let parsedBatchResult = null;
    let batchInputDebounce = null;

    function refreshBatchPreview() {
      const text = $("batchImportText").value;
      const autoSplit = $("batchAutoSplit").checked;
      const result = parseBatchInput(text, autoSplit);
      parsedBatchResult = result;

      const totalTopics = result.topics.length;
      const validTopics = result.topics.filter(t => t.words.length > 0);
      const totalWords = validTopics.reduce((sum, t) => sum + t.words.length, 0);

      $("batchCountBadge").textContent = `Распознано: ${totalTopics} тем`;
      $("batchCountBadge").className = `badge ${validTopics.length > 0 ? "badge-green" : ""}`;
      $("batchWordsBadge").textContent = `Всего слов: ${totalWords}`;

      if (result.warnings.length > 0) {
        $("batchWarnBadge").hidden = false;
        $("batchWarnBadge").textContent = `${result.warnings.length} предпр.`;
      } else {
        $("batchWarnBadge").hidden = true;
      }

      $("batchImportApply").disabled = validTopics.length === 0;
      $("batchImportApply").textContent = validTopics.length > 0
        ? `Добавить ${validTopics.length} тем в книгу`
        : "Добавить темы в книгу";

      const container = $("batchPreviewList");
      container.replaceChildren();

      if (!totalTopics) {
        container.append(node("div", "small-text muted", "Вставьте текст выше, чтобы увидеть предпросмотр распознавания..."));
        return;
      }

      result.topics.forEach((t, i) => {
        const item = node("div", `batch-item-row ${t.status}`);
        const num = node("span", "mono muted", `#${i + 1}`);
        const title = node("b", "", t.name);

        const wordsDiv = node("span", "small-text muted batch-item-words");
        if (t.words.length) {
          wordsDiv.textContent = t.words.slice(0, 6).join(", ") + (t.words.length > 6 ? ` … (+${t.words.length - 6})` : "");
        } else {
          wordsDiv.textContent = "— нет слов —";
        }

        const badgeClass = t.status === "ok" ? "badge-green" : t.status === "warn" ? "badge-amber" : "badge-red";
        const statusBadge = node("span", `badge ${badgeClass}`, t.statusText);

        item.append(num, title, wordsDiv, statusBadge);
        container.append(item);
      });
    }

    let batchCancelRequested = false;

    async function generateAllBookGrids(replaceAll = false) {
      const book = state.books[activeBookId];
      if (!book || !book.topics.length) { toast("В книге пока нет тем."); return; }
      if (replaceAll === true && !await confirmModal("Пересоздать все сетки книги? Текущие варианты сохранятся в локальной истории каждой темы.", "Пересоздать книгу")) return;
      const targets = book.topics.filter(t => replaceAll === true || StudioCore.needsGeneration(t));
      if (!targets.length) { toast("Все сетки уже созданы. Готовые варианты сохранены."); return; }
      batchCancelRequested = false;
      const modal = $("batchGenModal"); modal.showModal();
      let completed = 0;
      try {
        for (let i = 0; i < targets.length; i++) {
          if (batchCancelRequested || state.books[book.id] !== book) break;
          const topic = targets[i];
          const raw = topic.raw || topic.words.join(", ");
          const words = parseWords(raw).words;
          if (!words.length) continue;
          $("batchGenStatus").textContent = `${i + 1} / ${targets.length} · ${topic.name}`;
          const before = {...clone(topic),settings:clone(topic.settings||book.settings),grid:topic.grid||Array(CELLS).fill("·")};
          const layout = await generateGrid(words, topic.settings||book.settings, () => batchCancelRequested || state.books[book.id] !== book);
          if (!layout || batchCancelRequested || state.books[book.id] !== book) break;
          if (!book.topics.includes(topic) || (topic.raw || topic.words.join(", ")) !== raw) continue;
          topic.words=words;topic.grid=[...layout.grid];topic.placements=clone(layout.placements);
          editorHistory.record(`book:${book.id}:${topic.id}`,before,{...clone(topic),settings:clone(topic.settings||book.settings)},"Генерация книги");
          persistHistory();
          completed++;book.updatedAt=Date.now();await persistState();
          $("batchGenProgressFill").style.width = Math.round((i+1)/targets.length*100)+"%";
          await sleep(0);
        }
      } catch(error) { toast(error.message); }
      finally {
        stateChanged();renderBookDetail();modal.close();
        toast(`${batchCancelRequested?"Остановлено":"Готово"}: создано ${completed} сеток.`);
      }
    }

    function printFullBook() { openExport('book'); }

    function escapeXml(str) {
      return String(str || "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;"
      }[ch]));
    }

    function createTypographySVG(board, isAnswerSheet = false) {
      const occupiedIndices = new Set((board.placements || []).flatMap(p => p.cells));
      const cols = SIZE;
      const rows = SIZE;
      const cellSize = 40;
      const gridWidth = cols * cellSize;
      const gridHeight = rows * cellSize;
      const startX = 100;
      const wrapText = (text, limit) => {
        const lines=[];let line='';
        for(const word of String(text).split(/\s+/)){if(line.length+word.length+1>limit&&line){lines.push(line);line='';}line+=(line?' ':'')+word;}
        if(line)lines.push(line);return lines;
      };
      const titleLines=wrapText((board.name||"Филворд")+(isAnswerSheet?" — Ответы":""),42);
      const ruleLines=wrapText(isAnswerSheet?"Расположение и координаты слов в сетке":StudioPrint.rules(board.settings),88);
      const startY = 55 + titleLines.length*30 + ruleLines.length*18 + 25;

      const words = board.words || [];
      const placements = board.placements || [];

      const wordsRows = Math.ceil(words.length / 3);
      const wordsHeight = Math.max(120, wordsRows * 26 + 60);
      const totalHeight = startY + gridHeight + wordsHeight + 80;
      const totalWidth = 800;

      let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}">
  <defs>
    <style>
      .title { font-family: 'Segoe UI', -apple-system, sans-serif; font-size: 24px; font-weight: bold; fill: #111; }
      .subtitle { font-family: 'Segoe UI', -apple-system, sans-serif; font-size: 13px; fill: #666; font-style: italic; }
      .grid-border { fill: none; stroke: #222; stroke-width: 2; }
      .grid-line { stroke: #bbb; stroke-width: 0.8; }
      .letter { font-family: Consolas, 'Liberation Mono', monospace; font-size: 19px; font-weight: bold; text-anchor: middle; dominant-baseline: central; }
      .word-item { font-family: 'Segoe UI', -apple-system, sans-serif; font-size: 13px; fill: #222; }
      .coord-text { font-family: Consolas, monospace; font-size: 12px; fill: #444; }
      .coord-header { font-family: 'Segoe UI', -apple-system, sans-serif; font-size: 14px; font-weight: bold; fill: #111; }
    </style>
  </defs>

  <rect width="${totalWidth}" height="${totalHeight}" fill="#ffffff" />
  ${titleLines.map((line,i)=>`<text x="400" y="${45+i*30}" text-anchor="middle" class="title">${escapeXml(line)}</text>`).join('')}
  ${ruleLines.map((line,i)=>`<text x="400" y="${55+titleLines.length*30+i*18}" text-anchor="middle" class="subtitle">${escapeXml(line)}</text>`).join('')}
  <rect x="${startX}" y="${startY}" width="${gridWidth}" height="${gridHeight}" fill="#fdfdfd" class="grid-border" />
`;

      for (let i = 1; i < cols; i++) {
        const x = startX + i * cellSize;
        svg += `  <line x1="${x}" y1="${startY}" x2="${x}" y2="${startY + gridHeight}" class="grid-line" />\n`;
      }
      for (let j = 1; j < rows; j++) {
        const y = startY + j * cellSize;
        svg += `  <line x1="${startX}" y1="${y}" x2="${startX + gridWidth}" y2="${y}" class="grid-line" />\n`;
      }

      if (isAnswerSheet) {
        svg += `  <!-- Капсулы слов (ответы) -->\n`;
        placements.forEach((p, pIdx) => {
          if (!p.cells || p.cells.length === 0) return;
          const color = COLORS[pIdx % COLORS.length];
          const first = p.cells[0];
          const last = p.cells[p.cells.length - 1];

          const r1 = Math.floor(first / cols);
          const c1 = first % cols;
          const r2 = Math.floor(last / cols);
          const c2 = last % cols;

          const x1 = startX + c1 * cellSize + cellSize / 2;
          const y1 = startY + r1 * cellSize + cellSize / 2;
          const x2 = startX + c2 * cellSize + cellSize / 2;
          const y2 = startY + r2 * cellSize + cellSize / 2;

          svg += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="30" stroke-linecap="round" opacity="0.38" />\n`;
          svg += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2.5" stroke-dasharray="5,4" stroke-linecap="round" opacity="0.9" />\n`;
          svg += `  <circle cx="${x1}" cy="${y1}" r="4.5" fill="${color}" stroke="#ffffff" stroke-width="1.5" />\n`;
          svg += `  <circle cx="${x2}" cy="${y2}" r="3.5" fill="#ffffff" stroke="${color}" stroke-width="2" />\n`;
        });
      }

      svg += `  <!-- Буквы сетки -->\n`;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const index = r * cols + c;
          const letter = (board.grid && board.grid[index]) || "·";
          const cx = startX + c * cellSize + cellSize / 2;
          const cy = startY + r * cellSize + cellSize / 2;

          const isOccupied = occupiedIndices.has(index);
          const fill = isAnswerSheet
            ? (isOccupied ? "#000000" : "#a8a8a8")
            : "#111111";
          const weight = (isAnswerSheet && !isOccupied) ? "normal" : "bold";

          svg += `  <text x="${cx}" y="${cy}" fill="${fill}" font-weight="${weight}" class="letter">${escapeXml(letter)}</text>\n`;
        }
      }

      svg += `  <rect x="${startX}" y="${startY}" width="${gridWidth}" height="${gridHeight}" class="grid-border" />\n`;

      const bottomY = startY + gridHeight + 35;

      if (!isAnswerSheet) {
        svg += `  <!-- Список слов для поиска -->\n`;
        svg += `  <text x="100" y="${bottomY}" class="coord-header">Найдите слова (${words.length}):</text>\n`;

        const colWidth = 205;
        const colStartX = 100;
        const wordsListY = bottomY + 24;

        words.forEach((word, idx) => {
          const col = idx % 3;
          const row = Math.floor(idx / 3);
          const wx = colStartX + col * colWidth;
          const wy = wordsListY + row * 22;

          svg += `  <rect x="${wx}" y="${wy - 10}" width="11" height="11" fill="none" stroke="#666" stroke-width="1.2" rx="2" />\n`;
          svg += `  <text x="${wx + 18}" y="${wy}" class="word-item">${escapeXml(word)}</text>\n`;
        });
      } else {
        svg += `  <!-- Реестр координат ответов -->\n`;
        svg += `  <text x="100" y="${bottomY}" class="coord-header">Координаты найденных слов (${placements.length}):</text>\n`;

        const colWidth = 205;
        const colStartX = 100;
        const coordsListY = bottomY + 24;

        placements.forEach((p, idx) => {
          const col = idx % 3;
          const row = Math.floor(idx / 3);
          const cx = colStartX + col * colWidth;
          const cy = coordsListY + row * 22;
          const color = COLORS[idx % COLORS.length];

          const firstCoord = coord(p.cells[0]);
          const lastCoord = coord(p.cells[p.cells.length - 1]);
          const dir = directionOf(p.cells);

          svg += `  <circle cx="${cx + 5}" cy="${cy - 3}" r="5" fill="${color}" />\n`;
          svg += `  <text x="${cx + 16}" y="${cy}" class="coord-text"><tspan font-weight="bold" fill="#111">${escapeXml(p.word)}</tspan>: ${firstCoord}–${lastCoord} (${dir})</text>\n`;
        });
      }

      svg += `</svg>`;
      return svg;
    }

    function svgTo300DpiPngBlob(svgString) {
      return new Promise((resolve, reject) => {
        const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        img.onload = () => {
          const scale = 2.5;
          const canvas = document.createElement("canvas");
          canvas.width = (img.naturalWidth || 800) * scale;
          canvas.height = (img.naturalHeight || 1130) * scale;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error("Не удалось сформировать растровый PNG"));
          }, "image/png");
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Ошибка растровой отрисовки SVG"));
        };
        img.src = url;
      });
    }

    function downloadBlob(blob, name) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    function copyText(text, success = "Скопировано в буфер обмена.") {
      try {
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.top = "0";
        area.style.left = "0";
        area.style.width = "2em";
        area.style.height = "2em";
        area.style.padding = "0";
        area.style.border = "none";
        area.style.outline = "none";
        area.style.boxShadow = "none";
        area.style.background = "transparent";
        area.style.opacity = "0.01";
        area.setAttribute("readonly", "");
        document.body.appendChild(area);
        area.focus();
        area.select();
        area.setSelectionRange(0, area.value.length);
        const ok = document.execCommand("copy");
        document.body.removeChild(area);
        if (ok) {
          toast(success);
          return true;
        }
      } catch (err) {}

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
          toast(success);
        }).catch(() => {
          toast("Не удалось скопировать в буфер.");
        });
        return;
      }
      toast("Буфер обмена недоступен в этом браузере.");
    }

    function exportBoardXLSX(board = currentBoardEntity().value) {
      if (typeof XLSX === "undefined") {
        toast("Библиотека XLSX ещё загружается...");
        return;
      }
      if (!board || !board.grid) {
        toast("Нет данных сетки для экспорта.");
        return;
      }

      const wb = XLSX.utils.book_new();
      const gridSheet = XLSX.utils.aoa_to_sheet(gridRows(board.grid));
      gridSheet["!cols"] = Array.from({ length: SIZE }, () => ({ wch: 4 }));
      gridSheet["!rows"] = Array.from({ length: SIZE }, () => ({ hpt: 24 }));

      const wordRows = [["Слово", "Статус", "Начало", "Конец", "Направление"]];
      (board.words || []).forEach(word => {
        const placement = (board.placements || []).find(p => p.word === word);
        wordRows.push([
          word,
          placement ? "Размещено" : "Не размещено",
          placement ? coord(placement.cells[0]) : "",
          placement ? coord(placement.cells[placement.cells.length - 1]) : "",
          placement ? directionOf(placement.cells) : ""
        ]);
      });

      const wordSheet = XLSX.utils.aoa_to_sheet(wordRows);
      wordSheet["!cols"] = [{ wch: 24 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 15 }];

      const occupied = new Set((board.placements || []).flatMap(p => p.cells));
      const answerGrid = board.grid.map((letter, i) => occupied.has(i) ? letter : "");
      const answerSheet = XLSX.utils.aoa_to_sheet(gridRows(answerGrid));
      answerSheet["!cols"] = Array.from({ length: SIZE }, () => ({ wch: 4 }));
      answerSheet["!rows"] = Array.from({ length: SIZE }, () => ({ hpt: 24 }));

      XLSX.utils.book_append_sheet(wb, gridSheet, "Сетка");
      XLSX.utils.book_append_sheet(wb, wordSheet, "Слова и координаты");
      XLSX.utils.book_append_sheet(wb, answerSheet, "Ответы");

      XLSX.writeFile(wb, `${filename(board.name || "WordVault")}.xlsx`);
      toast(`Файл «${board.name}» (XLSX) сохранён.`);
    }

    function printCurrentBoard() { openExport('board'); }

    async function exportBookXLSX() {
      if (typeof XLSX === "undefined") {
        toast("Библиотека XLSX ещё загружается.");
        return;
      }
      if (!activeBookId) return;
      const book = state.books[activeBookId];
      if (!book || !book.topics.length) return;

      const wb = XLSX.utils.book_new();

      const tocRows = [["№", "Тема", "Слов", "Статус укладки"]];
      book.topics.forEach((t, i) => {
        tocRows.push([i + 1, t.name, t.words.length, t.placements?.length ? "Готово" : "Не сгенерировано"]);
      });
      const tocSheet = XLSX.utils.aoa_to_sheet(tocRows);
      XLSX.utils.book_append_sheet(wb, tocSheet, "Оглавление");

      book.topics.forEach((t, i) => {
        const safeName = `${i + 1}. ${t.name}`.slice(0, 30).replace(/[\\/?*:[\]]/g, "_");
        const rows = [
          [`Головоломка №${i + 1}: ${t.name}`],
          [],
          ...gridRows(t.grid || Array(CELLS).fill("·")),
          [],
          ["Слово", "Координаты", "Направление"]
        ];

        (t.placements || []).forEach(p => {
          rows.push([p.word, `${coord(p.cells[0])}–${coord(p.cells[p.cells.length - 1])}`, directionOf(p.cells)]);
        });

        const sheet = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, sheet, safeName);
      });

      XLSX.writeFile(wb, `${filename(book.title)}.xlsx`);
      toast("Файл книги XLSX сохранён.");
    }

    function gridRows(grid) {
      return Array.from({ length: SIZE }, (_, r) => grid.slice(r * SIZE, (r + 1) * SIZE));
    }
    function gridTSV(grid) {
      return gridRows(grid).map(row => row.join("\t")).join("\n");
    }
    function filename(name) {
      return (name || "WordVault").replace(/[\\/:*?"<>|]/g, "_").slice(0, 100);
    }
    function download(data, name, type) {
      const blob = new Blob([data], { type });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    function exportBackup() {
      download(
        JSON.stringify({
          format: "WordVaultBackup",
          version: SCHEMA,
          exportedAt: new Date().toISOString(),
          state
        }, null, 2),
        `WordVault_Backup_${new Date().toISOString().slice(0, 10)}.json`,
        "application/json"
      );
      toast("Резервная копия скачана.");
    }

    async function importBackup(file) {
      if (!file) return;
      if (file.size > MAX_PAYLOAD * 2) { toast("Файл слишком большой."); return; }

      try {
        const raw = JSON.parse(await file.text());
        let items = [];
        let importedBoard = null;
        let importedBooks = {};

        if (raw.format === "WordVaultBackup" && (raw.version === 3 || raw.version === SCHEMA)) {
          const validated = validateState(raw.state);
          importedBoard = validated.board.value;
          items = Object.values(validated.topics || {})
            .filter(record => !record.deleted)
            .map(record => record.value);
          if (validated.books && Object.keys(validated.books).length) {
            importedBooks = validated.books;
          }
        } else if (raw.topics && typeof raw.topics === "object") {
          items = Object.values(raw.topics).map(t => ({
            name: t.name || "Тема",
            words: t.words || parseWords(t.raw || "").words,
            board: t.board || null
          }));
        } else {
          throw new Error("Неподдерживаемый формат JSON");
        }

        const confirmed = await confirmModal(`Импортировать ${items.length} тем из файла?`, "Импорт тем");
        if (!confirmed) return;
        Object.assign(state.books, importedBooks);

        for (const item of items) {
          const id = "import:" + uid();
          state.topics[id] = {
            rev: nextRevision(),
            deleted: false,
            value: {
              name: item.name,
              words: [...item.words],
              board: item.board ? clone(item.board) : null,
              updatedAt: Date.now(),
              conflict: false
            }
          };
        }

        if (importedBoard) {
          const replaceBoard = await confirmModal("Восстановить также текущую сетку из копии?", "Текущая сетка");
          if (replaceBoard) commitBoard(clone(importedBoard));
          else stateChanged();
        } else {
          stateChanged();
        }

        toast("Импорт завершён успешно.");
      } catch (error) {
        toast("Ошибка импорта: " + error.message);
      } finally {
        $("backupFile").value = "";
      }
    }

    async function switchTab(tab, options = {}) {
      // Navigating via the main Constructor tab returns to the free draft.
      // Leaving a book editor closes its transient editing session.
      if (!options.bookEditor && bookEditorBoard !== null) {
        leaveBookEditor();
        // Update the hidden constructor too: otherwise it reopens showing
        // the previously edited book grid despite the free board being active.
        renderConstructor(true);
      }
      if (activeTab === "play" && tab !== "play") {
        pauseGameClock();
        cancelSelection();
        saveGame();
        updateWakeLock(false);
      }

      activeTab = tab;
      ["constructor", "books", "reverse", "play", "topics"].forEach(name => {
        const viewEl = $("view-" + name);
        if (viewEl) viewEl.hidden = name !== tab;
        const btn = document.querySelector(`nav [data-tab="${name}"]`);
        if (btn) {
          btn.classList.toggle("active", name === tab);
          if (name === tab) btn.setAttribute("aria-current", "page");
          else btn.removeAttribute("aria-current");
        }
      });

      if (tab === "books") {
        if (!options.keepBook) { $("booksListView").hidden=false; $("bookDetailView").hidden=true; }
        renderBooks();
      }
      if (tab === "topics") renderTopics();
      if (tab === "play") {
        if (!game) newGame();
        else {
          renderGame();
          refreshGameClock();
        }
      }
    }

    const Reverse = {
      grid: Array(CELLS).fill("·"),
      active: null,
      highlight: [],
      count: 0,
      version: 0,
      results: [],
      scanToken: 0,

      init() {
        for (let i = 0; i < SIZE; i++) {
          $("columnLabels").append(node("span", "", String.fromCharCode(65 + i)));
          $("rowLabels").append(node("span", "", i + 1));
        }
        this.render();
      },
      invalidate() {
        this.version++;
        this.scanToken++;
        this.highlight = [];
        this.results = [];
        $("reverseResults").replaceChildren();
        $("reverseSummary").textContent = "Данные изменены — требуется проверка";
      },
      readRaw() {
        const raw = normalize($("reverseRaw").value);
        const cleaned = raw.replace(/[._]/g, "·").replace(/[^А-ЯA-Z·]/g, "");
        this.count = cleaned.length;
        this.invalidate();
        if (cleaned.length <= CELLS) {
          this.grid = Array.from({ length: CELLS }, (_, i) => cleaned[i] || "·");
        }
        this.updateCount();
        this.render();
      },
      updateCount() {
        $("reverseCount").textContent = `${this.count} / 225`;
        $("reverseWarning").hidden = this.count === CELLS;
        $("reverseWarning").textContent = this.count > CELLS
          ? "Символов больше 225. Исправьте ввод."
          : "Матрица неполная. Для пустых позиций используйте точки ·.";
      },
      writeRaw() {
        $("reverseRaw").value = this.grid.join("");
        this.count = CELLS;
        this.updateCount();
      },
      render() {
        createGrid($("reverseGrid"), this.grid, index => {
          this.active = index;
          this.highlight = [];
          this.render();
          $("reverseGrid").focus({ preventScroll: true });
        });
        this.highlight.forEach(index => {
          const cell = $("reverseGrid").children[index];
          if (cell) {
            cell.classList.add("highlight");
            cell.style.setProperty("--word-color", "#12866a");
          }
        });
        if (this.active !== null) {
          $("reverseGrid").children[this.active]?.classList.add("selected");
          $("reverseCellLabel").textContent = `${coord(this.active)}: ${this.grid[this.active]}`;
        } else {
          $("reverseCellLabel").textContent = "Выберите клетку";
        }
      },
      setLetter(letter, advance = true) {
        if (this.active === null) { toast("Сначала выберите клетку."); return; }
        const norm = normalize(letter);
        if (!/^[А-ЯA-Z·]$/.test(norm)) return;
        this.grid[this.active] = norm;
        if (advance) this.active = Math.min(CELLS - 1, this.active + 1);
        this.invalidate();
        this.writeRaw();
        this.render();
      },
      move(delta) {
        this.active = Math.max(0, Math.min(CELLS - 1, (this.active ?? 0) + delta));
        this.render();
      },
      handleKey(event) {
        if (activeTab !== "reverse" || event.target !== $("reverseGrid") ||
            event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;

        if (this.active === null) this.active = 0;
        const arrows = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -SIZE, ArrowDown: SIZE };

        if (Object.hasOwn(arrows, event.key)) {
          event.preventDefault();
          this.move(arrows[event.key]);
        } else if (/^[А-ЯA-ZЁ]$/.test(normalize(event.key))) {
          event.preventDefault();
          this.setLetter(event.key);
        } else if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          this.setLetter("·", false);
          if (event.key === "Backspace") this.move(-1);
        } else if (event.key === "Escape") {
          this.active = null;
          this.render();
        }
      },
      canScan() {
        if (this.count !== CELLS) {
          toast("Для проверки нужна строка из 225 позиций. Пустая позиция — точка ·.");
          return false;
        }
        return true;
      },
      async scan() {
        if (!this.canScan()) return;
        const parsed = parseWords($("reverseWords").value);
        if (!parsed.words.length) { toast("Введите слова для проверки."); return; }
        const token = ++this.scanToken;
        const grid = [...this.grid];
        const useTypos = $("reverseTypos").checked;
        const results = [];
        for (let i = 0; i < parsed.words.length; i++) {
          const word = parsed.words[i];
          const matches = findOccurrences(grid, word);
          const possible = !matches.length && useTypos ? findOccurrences(grid, word, 1, 4) : [];
          results.push({ word, matches, possible });
          if (i % 8 === 0) { await sleep(0); if (token !== this.scanToken) return; }
        }
        this.results = results;
        this.renderResults();
      },
      renderResults() {
        const container = $("reverseResults");
        container.replaceChildren();
        const found = this.results.filter(item => item.matches.length).length;
        $("reverseSummary").textContent = `Найдено ${found} из ${this.results.length}`;
        this.results.forEach(item => {
          const block = node("div", "result");
          block.append(node("b", item.matches.length ? "success-text" : "error-text",
            item.matches.length ? ` ${item.word}: ${item.matches.length}` : ` ${item.word}: не найдено`));
          const btns = node("div", "actions gap-small");
          item.matches.slice(0, 15).forEach(m => {
            btns.append(action(pathText(m.cells), () => {
              this.highlight = m.cells;
              this.render();
            }, "small"));
          });
          block.append(btns);
          container.append(block);
        });
      },
      async findTopic() {
        if (!this.canScan()) return;
        const topics = liveTopics();
        if (!topics.length) { toast("Каталог пуст."); return; }

        const token = ++this.scanToken;
        const grid = [...this.grid];
        const ranked = [];
        $("reverseSummary").textContent = "Сопоставление с каталогом…";

        for (let i = 0; i < topics.length; i++) {
          const item = topics[i][1].value;
          let matches = 0;

          for (const word of item.words) {
            if (findOccurrences(grid, word, 0, 1).length) matches++;
          }

          if (matches) ranked.push({ item, matches, ratio: matches / Math.max(1, item.words.length) });

          if (i % 3 === 0) {
            await sleep(0);
            if (token !== this.scanToken) return;
          }
        }

        ranked.sort((a, b) => b.matches - a.matches || b.ratio - a.ratio);

        if (!ranked.length) {
          $("reverseSummary").textContent = "Совпадений нет";
          toast("Совпадений с каталогом не найдено.");
          return;
        }

        const best = ranked[0];
        $("reverseWords").value = best.item.words.join(", ");
        toast(`Вероятная тема: ${best.item.name}. Совпало ${best.matches} из ${best.item.words.length}.`);
        await this.scan();
      },
      async apply() {
        if (!this.canScan()) return;
        const words = parseWords($("reverseWords").value).words;

        const board = {
          id: uid(),
          name: currentBoardEntity().value.name,
          raw: $("reverseWords").value.slice(0, 30000),
          words,
          settings: clone(currentBoardEntity().value.settings),
          grid: [...this.grid],
          placements: placementsFromGrid(this.grid, words),
          createdAt: Date.now()
        };

        commitBoard(board);
        await switchTab("constructor", {bookEditor:true});
        toast("Сетка перенесена в конструктор.");
      }
    };

    let game = null;
    let gameRunningSince = null;
    let gameCursor = 0;
    let pointerId = null;
    let selectionStart = null;
    let selectionCells = [];
    let gameSaveTick = 0;

    function elapsedGame() {
      if (!game) return 0;
      return game.elapsedMs + (gameRunningSince === null ? 0 : performance.now() - gameRunningSince);
    }
    function formatTime(ms) {
      const s = Math.floor(ms / 1000);
      return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    }
    function pauseGameClock() {
      if (game && gameRunningSince !== null) game.elapsedMs += performance.now() - gameRunningSince;
      gameRunningSince = null;
    }
    function refreshGameClock() {
      const shouldRun = game && !game.completed && !game.manualPaused && activeTab === "play" && !document.hidden && game.board.placements.length > 0;
      if (shouldRun && gameRunningSince === null) gameRunningSince = performance.now();
      if (!shouldRun) pauseGameClock();
      renderGameStatus();
      updateWakeLock(shouldRun);
    }
    function saveGame() {
      if (!game) return;
      const s = clone(game);
      s.elapsedMs = elapsedGame();
      state.game = s;
      persistState();
      Sync.queuePush();
    }
    function updateGameNewBoard() {
      $("playNewBoard").hidden = !game || stable(game.board) === stable(currentBoardEntity().value);
    }
    function newGame() {
      pauseGameClock();
      game = { board: clone(currentBoardEntity().value), found: {}, elapsedMs: 0, manualPaused: false, completed: false };
      renderGame();
      refreshGameClock();
      saveGame();
      updateGameNewBoard();
    }
    function renderGameStatus() {
      $("playTimer").textContent = formatTime(elapsedGame());
      if (!game) return;
      $("playCounter").textContent = `${Object.keys(game.found).length} / ${game.board.placements.length}`;
      $("playPause").textContent = game.manualPaused ? "Продолжить" : "Пауза";
    }
    function renderGame() {
      if (!game) return;
      $("playTitle").textContent = game.board.name;
      createGrid($("playGrid"), game.board.grid);
      const list = $("playWords");
      list.replaceChildren();
      game.board.placements.forEach(p => {
        const done = Object.hasOwn(game.found, p.word);
        list.append(node("span", "chip" + (done ? " done" : ""), (done ? " " : "• ") + p.word));
      });
      paintGame();
      renderGameStatus();
    }
    function paintGame() {
      if (!game) return;
      const cells = $("playGrid").children;
      const foundCells = new Set(Object.values(game.found).flat());
      for (let i = 0; i < cells.length; i++) {
        cells[i].classList.toggle("found", foundCells.has(i));
        cells[i].classList.toggle("dragging", selectionCells.includes(i));
        cells[i].classList.toggle("selected", i === gameCursor && document.activeElement === $("playGrid"));
      }
    }
    function straightLine(start, end) {
      const r1 = Math.floor(start / SIZE), c1 = start % SIZE;
      const r2 = Math.floor(end / SIZE), c2 = end % SIZE;
      const dr = r2 - r1, dc = c2 - c1;
      if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return [];
      const len = Math.max(Math.abs(dr), Math.abs(dc));
      const sr = Math.sign(dr), sc = Math.sign(dc);
      return Array.from({ length: len + 1 }, (_, k) => (r1 + sr * k) * SIZE + c1 + sc * k);
    }
    function cancelSelection() { pointerId = null; selectionStart = null; selectionCells = []; paintGame(); }
    function finishSelection() {
      if (!game || selectionCells.length < 2) { cancelSelection(); return; }
      const letters = selectionCells.map(i => game.board.grid[i]).join("");
      const reversed = [...letters].reverse().join("");
      const match = game.board.placements.find(p => p.word === letters || p.word === reversed);
      if (match && !Object.hasOwn(game.found, match.word)) {
        game.found[match.word] = [...selectionCells];
        Sound.play(true);
        toast("Найдено: " + match.word);
        if (Object.keys(game.found).length === game.board.placements.length) {
          pauseGameClock();
          game.completed = true;
          $("victoryText").textContent = `${game.board.placements.length} слов за ${formatTime(game.elapsedMs)}.`;
          $("victoryDialog").showModal();
        }
        saveGame();
      }
      cancelSelection();
      renderGame();
      refreshGameClock();
    }

    function renderTopics() {
      const query = $("topicSearch") ? $("topicSearch").value.trim().toLowerCase() : "";
      const records = liveTopics();
      $("topicCount").textContent = records.length;
      const container = $("topicsGrid");
      container.replaceChildren();

      const filtered = records.filter(([, record]) => {
        const item = record.value;
        return !query || item.name.toLowerCase().includes(query) ||
          item.words.some(w => w.toLowerCase().includes(query));
      }).sort((a, b) => (b[1].value.updatedAt || 0) - (a[1].value.updatedAt || 0));

      filtered.forEach(([id, record]) => {
        const item = record.value;
        const card = node("article", "card topic-card");
        card.append(node("h3", "", item.name));
        card.append(node("span", "muted small-text", `${item.words.length} слов · ${item.board ? "сетка готова" : "список слов"}`));
        card.append(node("p", "mono small-text muted", item.words.slice(0, 15).join(", ") + (item.words.length > 15 ? "…" : "")));

        const actions = node("div", "actions");
        actions.append(action("Открыть", () => {
          leaveBookEditor();
          activeBookId = null;
          if (item.board) {
            commitBoard(clone(item.board));
          } else {
            $("topicName").value = item.name;
            $("wordsInput").value = item.words.join(", ");
            executeRebuild();
          }
          switchTab("constructor");
        }, "primary small"));

        actions.append(action(" Слова", () => {
          copyText(item.words.join(", "), `Слова темы «${item.name}» скопированы`);
        }, "small"));

        if (item.board) {
          actions.append(action(" XLSX", () => {
            exportBoardXLSX(item.board);
          }, "small"));
          actions.append(action(" Сетка (Excel)", () => {
            copyText(gridTSV(item.board.grid), `Сетка «${item.name}» скопирована для Excel.`);
          }, "small"));
        }

        actions.append(action("Удалить", async () => {
          const ok = await confirmModal(`Удалить тему «${item.name}» из каталога?`, "Удаление темы");
          if (!ok) return;
          state.topics[id] = { rev: nextRevision(), deleted: true };
          stateChanged();
          renderTopics();
          toast(`Тема «${item.name}» удалена.`);
        }, "danger small"));

        card.append(actions);
        container.append(card);
      });

      if (!filtered.length) {
        container.append(node("div", "card subtle muted", records.length ? "Ничего не найдено по запросу." : "Сохранённых тем пока нет. Нажмите « Сохранить» в конструкторе."));
      }
    }

    // Local history belongs to a stable editor context, never to the last opened grid.
    let editorHistory = new StudioCore.History();
    let restoringHistory = false;
    let historySaveTimer;
    let exportScope = 'board';
    let exportPage = 0;
    let exportPages = [];
    let exporting = false;
    let qualityCache = { signature: '', value: null };
    function historyKey() {
      return isBookEditor() ? `book:${activeBookId}:${state.books[activeBookId]?.topics[activeBookTopicIndex]?.id}` : 'free';
    }
    function persistHistory() {
      clearTimeout(historySaveTimer);
      historySaveTimer = setTimeout(() => DB.put('wv_studio_history_v1',editorHistory.serialize()),250);
    }
    function rememberBoard(before, after, label, coalesce=false) {
      if (restoringHistory) return;
      editorHistory.record(historyKey(),before,after,label,coalesce);
      persistHistory();
    }
    function moveHistory(delta) {
      const board = editorHistory.move(historyKey(), currentBoardEntity().value, delta);
      if (!board) return;
      generationRequest++;
      $('generateButton').disabled=false;
      restoringHistory=true;
      try { commitBoard(board); } finally { restoringHistory=false; }
      persistHistory();
    }
    const boardQualityCache = new Map();
    function boardQuality(board) {
      const key=StudioCore.signature(board);
      if(!boardQualityCache.has(key)){
        boardQualityCache.set(key,StudioCore.quality(board,parseWords,findOccurrences,validCells));
        if(boardQualityCache.size>800)boardQualityCache.delete(boardQualityCache.keys().next().value);
      }
      return boardQualityCache.get(key);
    }
    function renderStudio() {
      const board=currentBoardEntity().value;
      $('canvasTitle').textContent=board.name;
      $('copyToFreeButton').hidden=!isBookEditor();
      $('generateButton').textContent=board.placements.length?'Перестроить сетку':'Создать сетку';
      $('revealButton').textContent=showAnswers?'Скрыть ответы':'Ответы';
      $('revealButton').setAttribute('aria-pressed',String(showAnswers));
      const signature=StudioCore.signature(board);
      if(qualityCache.signature!==signature)qualityCache={signature,value:boardQuality(board)};
      const q=qualityCache.value;
      $('qualitySummary').replaceChildren(node('div','quality-score',`${q.found} / ${q.total}`),node('p','quality-note',q.ready?'Слова на месте. Сетка готова.':'Слов найдено на поле'));
      $('qualityDetails').replaceChildren();
      for(const issue of q.issues){const item=node('div',`quality-item ${issue.level}`);item.append(node('strong','',issue.title),node('span','muted',issue.detail));$('qualityDetails').append(item);}
      if(!q.issues.length)$('qualityDetails').append(node('div','quality-note','Повторов и ошибок в ответах не обнаружено.'));
      const h=editorHistory.get(historyKey(),board);
      if(StudioCore.signature(h.entries[h.cursor].board)!==signature){editorHistory.record(historyKey(),h.entries[h.cursor].board,board,'Внешнее изменение');persistHistory();}
      $('undoButton').disabled=h.cursor===0;
      $('redoButton').disabled=h.cursor===h.entries.length-1;
      $('historyCount').textContent=`· ${h.entries.length}`;
      $('historyList').replaceChildren();
      h.entries.map((entry,index)=>({entry,index})).reverse().forEach(({entry,index})=>{
        const btn=action(`${entry.label} · ${new Date(entry.time).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`,()=>moveHistory(index-h.cursor),'history-entry'+(index===h.cursor?' active':''));
        btn.disabled=index===h.cursor;
        $('historyList').append(btn);
      });
    }
    function setMobilePanel(panel) {
      const workspace=document.querySelector('.studio-workspace');
      if(workspace)workspace.dataset.mobilePanel=panel;
      document.querySelectorAll('[data-panel]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.panel===panel)));
    }
    function exportData() {
      if(exportScope==='book'){
        const book=state.books[activeBookId];
        return {title:book?.title||'Книга',author:book?.author||'',book:true,boards:(book?.topics||[]).map(t=>({...clone(t),settings:clone(t.settings||book.settings),grid:t.grid||Array(CELLS).fill('·')}))};
      }
      const board=clone(currentBoardEntity().value);
      return {title:board.name,book:false,boards:[board]};
    }
    function openExport(scope='board') {
      exportScope=scope;exportPage=0;
      const format=$('exportFormat');
      for(const option of format.options) option.disabled=scope==='book'&&['tsv','raw'].includes(option.value);
      if(scope==='book'&&['tsv','raw'].includes(format.value))format.value='pdf';
      renderExport();
      $('exportDialog').showModal();
    }
    function renderExport() {
      const data=exportData(),format=$('exportFormat').value,sheets=$('exportSheets').value;
      const checks=data.boards.map(boardQuality);
      const errors=checks.filter(q=>!q.ready).length;
      const warnings=checks.reduce((n,q)=>n+q.issues.filter(x=>x.level==='warn').length,0);
      $('exportTitle').textContent=data.book?`Экспорт · ${data.title}`:'Экспорт темы';
      $('exportQuality').textContent=!data.boards.length?'В книге пока нет тем.':errors?`${errors} из ${data.boards.length} сеток требуют исправлений. Вернитесь к проверке качества. Исходник JSON можно сохранить в любом состоянии.`:warnings?`Сетки готовы. Замечаний: ${warnings}. Проверьте их в редакторе перед печатью.`:'Проверка пройдена. Все слова и ответы на месте.';
      $('performExportButton').disabled=exporting||((errors>0||!data.boards.length)&&format!=='json');
      const labels={pdf:'Печать / PDF',svg:data.book||sheets==='both'?'Скачать SVG · ZIP':'Скачать SVG',png:data.book||sheets==='both'?'Скачать PNG · ZIP':'Скачать PNG',xlsx:'Скачать XLSX',tsv:'Копировать для Excel',raw:'Копировать 225 букв',json:'Скачать JSON'};
      $('performExportButton').textContent=labels[format];
      $('exportSheets').disabled=['xlsx','tsv','raw','json'].includes(format);
      $('exportDescription').textContent=format==='pdf'?'В окне печати выберите «Сохранить как PDF», масштаб 100% и отключите колонтитулы браузера.':format==='svg'||format==='png'?'Файлы для типографии. Несколько листов собираются в ZIP; PNG — 300 DPI.':format==='json'?'Редактируемый исходник. Макет справа показывает печатную версию.':'Табличные данные. Макет справа показывает печатную версию.';
      if(['svg','png'].includes(format)){
        exportPages=[];
        for(const board of data.boards){
          if(sheets!=='answers')exportPages.push(createTypographySVG(board,false));
          if(sheets!=='puzzle')exportPages.push(createTypographySVG(board,true));
        }
        exportPage=Math.max(0,Math.min(exportPage,exportPages.length-1));
        $('printPreview').srcdoc=`<!doctype html><html lang="ru"><meta charset="utf-8"><style>body{margin:0}svg{display:block;width:100%;height:auto}</style><body>${exportPages[exportPage]||''}</body></html>`;
      }else{
        exportPages=StudioPrint.pages({...data,sheets});
        exportPage=Math.max(0,Math.min(exportPage,exportPages.length-1));
        $('printPreview').srcdoc=StudioPrint.documentHTML(data.title,exportPages[exportPage]||'',true);
      }
      $('previewPageCount').textContent=`${exportPages.length?exportPage+1:0} / ${exportPages.length}`;
      $('previewPrev').disabled=exportPage<=0;
      $('previewNext').disabled=exportPage>=exportPages.length-1;
    }
    function printDocument(data,sheets) {
      const win=window.open('','_blank');
      if(!win){toast('Разрешите всплывающие окна для печати.');return;}
      const pages=StudioPrint.pages({...data,sheets});
      win.document.open();
      win.document.write(StudioPrint.documentHTML(data.title,pages.join('')));
      win.document.close();
      const controls=win.document.createElement('div');controls.className='controls';
      const button=win.document.createElement('button');button.textContent='Печать / Сохранить PDF';button.onclick=()=>win.print();controls.append(button);win.document.body.prepend(controls);
      win.focus();setTimeout(()=>win.print(),300);
    }
    async function performExport() {
      if(exporting)return;
      const data=exportData(),format=$('exportFormat').value,sheets=$('exportSheets').value;
      if(format!=='json'&&(!data.boards.length||data.boards.some(b=>!boardQuality(b).ready))){renderExport();return;}
      exporting=true;$('performExportButton').disabled=true;$('exportStatus').textContent='Подготовка…';
      try{
        if(format==='pdf')printDocument(data,sheets);
        else if(format==='json')download(JSON.stringify(data.book?state.books[activeBookId]:{topics:[{name:data.title,words:data.boards[0].words,board:data.boards[0]}]},null,2),`${filename(data.title)}.json`,'application/json');
        else if(format==='xlsx'){if(typeof XLSX==='undefined')throw new Error('Не загрузилась библиотека Excel. Проверьте соединение и повторите.');if(data.book)await exportBookXLSX();else exportBoardXLSX(data.boards[0]);}
        else if(format==='tsv')await copyText(gridTSV(data.boards[0].grid));
        else if(format==='raw')await copyText(data.boards[0].grid.join(''));
        else{
          const types=sheets==='both'?[false,true]:[sheets==='answers'];
          const zipNeeded=data.book||types.length>1;
          if(zipNeeded&&typeof JSZip==='undefined')throw new Error('Не загрузилась библиотека ZIP. Проверьте соединение и повторите.');
          const zip=zipNeeded?new JSZip():null;
          for(let i=0;i<data.boards.length;i++){
            const board=data.boards[i];
            $('exportStatus').textContent=`Подготовка ${i+1} / ${data.boards.length}…`;
            for(const answer of types){
              const svg=createTypographySVG(board,answer);
              const blob=format==='svg'?new Blob([svg],{type:'image/svg+xml;charset=utf-8'}):await svgTo300DpiPngBlob(svg);
              const name=`${String(i+1).padStart(2,'0')}_${filename(board.name)}_${answer?'ответы':'задание'}.${format}`;
              if(zip)zip.file(name,blob);else downloadBlob(blob,name);
            }
            await sleep(0);
          }
          if(zip)downloadBlob(await zip.generateAsync({type:'blob'}),`${filename(data.title)}_${format}.zip`);
        }
        $('exportStatus').textContent=format==='pdf'?'Открыто окно печати.':'Готово.';
      }catch(error){$('exportStatus').textContent=error.message;toast(error.message);}
      finally{exporting=false;renderExport();}
    }
    function bindStudioEvents() {
      $('undoButton').addEventListener('click',()=>moveHistory(-1));
      $('redoButton').addEventListener('click',()=>moveHistory(1));
      document.addEventListener('keydown',event=>{
        if(activeTab!=='constructor'||!(event.ctrlKey||event.metaKey)||document.querySelector('dialog[open]'))return;
        if(event.target?.matches?.('input,textarea,select,[contenteditable="true"]'))return;
        if(event.key.toLowerCase()==='z'){event.preventDefault();moveHistory(event.shiftKey?1:-1);}
        if(event.key.toLowerCase()==='y'){event.preventDefault();moveHistory(1);}
      });
      document.querySelectorAll('[data-panel]').forEach(b=>b.addEventListener('click',()=>setMobilePanel(b.dataset.panel)));
      $('resumeDraftButton').addEventListener('click',()=>switchTab('constructor'));
      $('editorPlayButton').addEventListener('click',()=>{if(!currentBoardEntity().value.placements.length){toast('Сначала создайте сетку.');return;} if(!game || StudioCore.signature(game.board)!==StudioCore.signature(currentBoardEntity().value))newGame();switchTab('play',{bookEditor:true});});
      $('editorAuditButton').addEventListener('click',()=>{$('reverseLoad').click();switchTab('reverse',{bookEditor:true});});
      $('copyToFreeButton').addEventListener('click',async()=>{
        const copy=clone(currentBoardEntity().value);
        if(!await confirmModal('Заменить свободный черновик копией этой темы? Предыдущую сетку можно восстановить в его истории.','Копия темы'))return;
        await switchTab('constructor');commitBoard(copy);toast('Создана независимая копия.');
      });
      ['dirH','dirV','dirD','dirR','allowOverlap','fillerMode'].forEach(id=>$(id).addEventListener('change',()=>{
        const before=clone(currentBoardEntity().value);
        currentBoardEntity().value.settings=settingsFromUI();
        if(isBookEditor()){state.books[activeBookId].topics[activeBookTopicIndex].settings=clone(currentBoardEntity().value.settings);state.books[activeBookId].updatedAt=Date.now();}
        generationRequest++;$('generateButton').disabled=false;
        rememberBoard(before,currentBoardEntity().value,'Настройки');
        $('rebuildHint').hidden=false;stateChanged();renderStudio();
      }));
      $('editorExportButton').addEventListener('click',()=>openExport('board'));
      $('bookExportButton').addEventListener('click',()=>openExport('book'));
      $('closeExportButton').addEventListener('click',()=>$('exportDialog').close());
      ['exportFormat','exportSheets'].forEach(id=>$(id).addEventListener('change',()=>{exportPage=0;renderExport();}));
      $('previewPrev').addEventListener('click',()=>{exportPage--;renderExport();});
      $('previewNext').addEventListener('click',()=>{exportPage++;renderExport();});
      $('performExportButton').addEventListener('click',performExport);
      $('regenerateBookButton').addEventListener('click',()=>generateAllBookGrids(true));
      $('batchGenModal').addEventListener('cancel',()=>{batchCancelRequested=true;});
    }

    function bindEvents() {
      document.querySelectorAll("[data-tab]").forEach(btn => {
        btn.addEventListener("click", () => switchTab(btn.dataset.tab, {bookEditor: btn.dataset.tab === "constructor" && !btn.closest("nav")}));
      });

      $("wordsInput").addEventListener("input", () => { updateInputWarnings(); autoSaveMetaOnly(); });
      $("topicName").addEventListener("input", autoSaveMetaOnly);
      $("generateButton").addEventListener("click", executeRebuild);

      $("saveTopicButton").addEventListener("click", () => {
        const b = currentBoardEntity().value;
        if (!b.words.length) { toast("Сначала создайте сетку со словами."); return; }
        const id = "topic:" + b.name.toLowerCase();
        state.topics[id] = { rev: nextRevision(), deleted: false, value: { name: b.name, words: [...b.words], board: clone(b), updatedAt: Date.now() } };
        stateChanged();
        toast("Тема сохранена в каталог.");
      });

      $("clearButton").addEventListener("click", async () => {
        const inBook = isBookEditor();
        const session = editorSession;
        const message = inBook
          ? "Очистить сетку этой темы в книге? Список слов и название сохранятся."
          : "Очистить свободную сетку? Книги и каталог тем сохранятся.";
        const ok = await confirmModal(message, "Очистка");
        if (!ok || session !== editorSession || inBook !== isBookEditor()) return;
        generationRequest++;
        $("generateButton").disabled = false;
        const board = inBook
          ? { ...clone(currentBoardEntity().value), grid: Array(CELLS).fill("·"), placements: [] }
          : emptyBoard();
        board.id = uid();
        board.createdAt = Date.now();
        commitBoard(board);
        $("generationStatus").textContent = "";
        toast(inBook ? "Сетка темы очищена. Слова сохранены." : "Свободный конструктор очищен.");
      });

      $("revealButton").addEventListener("click", () => {
        showAnswers = !showAnswers;
        renderConstructor();
      });

      $("xlsxButton").addEventListener("click", () => exportBoardXLSX());
      $("headerExcel").addEventListener("click", () => openExport(activeTab === "books" && !$("bookDetailView").hidden ? "book" : "board"));

      $("tsvButton").addEventListener("click", () => {
        copyText(gridTSV(currentBoardEntity().value.grid), "Сетка скопирована для Excel (TSV).");
      });

      $("rawButton").addEventListener("click", () => {
        copyText(currentBoardEntity().value.grid.join(""), "Скопировано 225 символов матрицы.");
      });

      $("printButton").addEventListener("click", () => printCurrentBoard());

      /* ==========================================================================
         СЛУШАТЕЛИ ЭКСПОРТА ТИПОГРАФИИ (SVG / 300 DPI) ДЛЯ ТЕКУЩЕЙ ТЕМЫ
         ========================================================================== */
      $("openTypoModalBtn")?.addEventListener("click", () => {
        const board = currentBoardEntity().value;
        if (!board || !board.grid || !board.words.length) {
          toast("Сначала создайте или перестройте сетку темы.");
          return;
        }
        $("typoModal")?.showModal();
      });

      $("closeTypoModalBtn")?.addEventListener("click", () => $("typoModal")?.close());

      $("downloadPuzzleSvgBtn")?.addEventListener("click", () => {
        const board = currentBoardEntity().value;
        const svg = createTypographySVG(board, false);
        download(svg, `${filename(board.name)}_головоломка.svg`, "image/svg+xml;charset=utf-8");
        toast("Векторный SVG задания скачан.");
      });

      $("downloadPuzzlePngBtn")?.addEventListener("click", async () => {
        const board = currentBoardEntity().value;
        toast("Генерация растра 300 DPI…");
        try {
          const svg = createTypographySVG(board, false);
          const pngBlob = await svgTo300DpiPngBlob(svg);
          downloadBlob(pngBlob, `${filename(board.name)}_головоломка_300dpi.png`);
          toast("Файл PNG 300 DPI сохранён.");
        } catch (err) {
          toast("Ошибка генерации PNG: " + err.message);
        }
      });

      $("downloadAnswersSvgBtn")?.addEventListener("click", () => {
        const board = currentBoardEntity().value;
        const svg = createTypographySVG(board, true);
        download(svg, `${filename(board.name)}_ответы.svg`, "image/svg+xml;charset=utf-8");
        toast("Векторный SVG с ответами скачан.");
      });

      $("downloadAnswersPngBtn")?.addEventListener("click", async () => {
        const board = currentBoardEntity().value;
        toast("Генерация растра 300 DPI с ответами…");
        try {
          const svg = createTypographySVG(board, true);
          const pngBlob = await svgTo300DpiPngBlob(svg);
          downloadBlob(pngBlob, `${filename(board.name)}_ответы_300dpi.png`);
          toast("Файл ответов PNG 300 DPI сохранён.");
        } catch (err) {
          toast("Ошибка генерации PNG: " + err.message);
        }
      });

      /* ==========================================================================
         СЛУШАТЕЛИ ПАКЕТНОГО ЭКСПОРТА ВСЕЙ КНИГИ В ZIP
         ========================================================================== */
      $("openBatchTypoModalBtn")?.addEventListener("click", () => {
        if (!activeBookId) return;
        const book = state.books[activeBookId];
        if (!book || !book.topics.length) {
          toast("В книге нет тем для экспорта.");
          return;
        }
        if ($("batchTypoProgressWrap")) $("batchTypoProgressWrap").hidden = true;
        if ($("startBatchTypoBtn")) $("startBatchTypoBtn").disabled = false;
        $("batchTypoModal")?.showModal();
      });

      $("closeBatchTypoModalBtn")?.addEventListener("click", () => $("batchTypoModal")?.close());

      $("startBatchTypoBtn")?.addEventListener("click", async () => {
        if (typeof JSZip === "undefined") {
          toast("Библиотека JSZip ещё загружается. Подождите секунду...");
          return;
        }

        if (!activeBookId) return;
        const book = state.books[activeBookId];
        if (!book || !book.topics.length) return;

        const incPuzzles = $("batchIncludePuzzles")?.checked;
        const incAnswers = $("batchIncludeAnswers")?.checked;
        const fmtSvg = $("batchFormatSvg")?.checked;
        const fmtPng = $("batchFormatPng")?.checked;

        if (!incPuzzles && !incAnswers) {
          toast("Выберите хотя бы один тип файлов (задания или ответы).");
          return;
        }
        if (!fmtSvg && !fmtPng) {
          toast("Выберите хотя бы один формат (SVG или PNG 300 DPI).");
          return;
        }

        if ($("startBatchTypoBtn")) $("startBatchTypoBtn").disabled = true;
        if ($("batchTypoProgressWrap")) $("batchTypoProgressWrap").hidden = false;

        const zip = new JSZip();
        const total = book.topics.length;
        const puzzlesFolder = incPuzzles ? zip.folder("Головоломки") : null;
        const answersFolder = incAnswers ? zip.folder("Ответы") : null;

        for (let i = 0; i < total; i++) {
          const t = book.topics[i];
          const pct = Math.round(((i + 1) / total) * 100);
          if ($("batchTypoStatus")) $("batchTypoStatus").textContent = `Обработка темы ${i + 1} из ${total}: «${t.name}»…`;
          if ($("batchTypoPercent")) $("batchTypoPercent").textContent = `${pct}%`;
          if ($("batchTypoProgressFill")) $("batchTypoProgressFill").style.width = `${pct}%`;

          let grid = t.grid;
          let placements = t.placements;
          if (!grid || !placements || !placements.length) {
            toast("Сначала создайте недостающие сетки книги.");
            $("startBatchTypoBtn").disabled = false;
            return;
          }

          const boardData = {
            name: `${i + 1}. ${t.name}`,
            grid,
            placements,
            words: t.words,
            settings: t.settings || book.settings
          };

          const prefix = String(i + 1).padStart(2, "0") + "_" + filename(t.name);

          if (incPuzzles && puzzlesFolder) {
            const pSvg = createTypographySVG(boardData, false);
            if (fmtSvg) puzzlesFolder.file(`${prefix}_задание.svg`, pSvg);
            if (fmtPng) {
              const pPngBlob = await svgTo300DpiPngBlob(pSvg);
              puzzlesFolder.file(`${prefix}_задание_300dpi.png`, pPngBlob);
            }
          }

          if (incAnswers && answersFolder) {
            const aSvg = createTypographySVG(boardData, true);
            if (fmtSvg) answersFolder.file(`${prefix}_ответы.svg`, aSvg);
            if (fmtPng) {
              const aPngBlob = await svgTo300DpiPngBlob(aSvg);
              answersFolder.file(`${prefix}_ответы_300dpi.png`, aPngBlob);
            }
          }

          await sleep(15);
        }

        if ($("batchTypoStatus")) $("batchTypoStatus").textContent = "Упаковка архива ZIP…";
        const content = await zip.generateAsync({ type: "blob" });
        downloadBlob(content, `${filename(book.title)}_Типография.zip`);

        book.updatedAt = Date.now();
        stateChanged();

        $("batchTypoModal")?.close();
        toast(`Архив «${book.title}» успешно скачан!`);
      });

      $("topicSearch").addEventListener("input", renderTopics);
      $("exportBackup").addEventListener("click", exportBackup);
      $("importBackup").addEventListener("click", () => $("backupFile").click());
      $("backupFile").addEventListener("change", e => importBackup(e.target.files[0]));

      $("leaveBookEditorBtn").addEventListener("click", () => switchTab("constructor"));

      $("backToBookBtn").addEventListener("click", () => {
        if (activeBookId) {
          switchTab("books");
          openBook(activeBookId);
        }
      });

      $("prevBookTopicBtn").addEventListener("click", () => {
        if (activeBookId && activeBookTopicIndex > 0) {
          openTopicInConstructor(activeBookId, activeBookTopicIndex - 1);
        }
      });

      $("nextBookTopicBtn").addEventListener("click", () => {
        if (activeBookId) {
          const b = state.books[activeBookId];
          if (b && activeBookTopicIndex < b.topics.length - 1) {
            openTopicInConstructor(activeBookId, activeBookTopicIndex + 1);
          }
        }
      });

      $("backToBooksListBtn").addEventListener("click", () => {
        $("bookDetailView").hidden = true;
        $("booksListView").hidden = false;
        renderBooks();
      });

      $("createBookBtn").addEventListener("click", () => {
        $("bookModalTitle").textContent = "Создать новую книгу";
        ["bookDirH","bookDirV","bookDirD","bookDirR","bookAllowOverlap"].forEach(id => $(id).checked = true);
        $("bookFillerMode").value = "freq";
        $("bookModalName").value = "Новая книга";
        $("bookModalAuthor").value = "WordVault Studio";
        $("bookModal").showModal();
      });

      $("editBookSettingsBtn").addEventListener("click", () => {
        if (!activeBookId) return;
        const b = state.books[activeBookId];
        if (!b) return;
        $("bookModalTitle").textContent = "Настройки книги";
        $("bookModalName").value = b.title;
        $("bookModalAuthor").value = b.author;
        $("bookDirH").checked = b.settings.h;
        $("bookDirV").checked = b.settings.v;
        $("bookDirD").checked = b.settings.d;
        $("bookDirR").checked = b.settings.reverse;
        $("bookAllowOverlap").checked = b.settings.overlap;
        $("bookFillerMode").value = b.settings.filler;
        $("bookModal").showModal();
      });

      $("bookModalCancel").addEventListener("click", () => $("bookModal").close());

      $("bookModalSave").addEventListener("click", () => {
        const title = $("bookModalName").value.trim() || "Сборник филвордов";
        const author = $("bookModalAuthor").value.trim() || "WordVault";
        const settings = {
          h: $("bookDirH").checked,
          v: $("bookDirV").checked,
          d: $("bookDirD").checked,
          reverse: $("bookDirR").checked,
          overlap: $("bookAllowOverlap").checked,
          filler: $("bookFillerMode").value
        };

        if (activeBookId && state.books[activeBookId] && $("bookModalTitle").textContent.includes("Настройки")) {
          const b = state.books[activeBookId];
          b.title = title;
          b.author = author;
          b.settings = settings;
          b.updatedAt = Date.now();
        } else {
          const newId = "book:" + uid();
          state.books[newId] = {
            id: newId,
            title,
            author,
            settings,
            topics: [],
            updatedAt: Date.now()
          };
          activeBookId = newId;
        }

        $("bookModal").close();
        stateChanged();
        openBook(activeBookId);
      });

      $("addFastTopicBtn").addEventListener("click", addFastTopicToBook);
      $("fastTopicWords").addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); addFastTopicToBook(); }
      });
      $("fastTopicName").addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); $("fastTopicWords").focus(); }
      });

      $("openBatchImportBtn").addEventListener("click", () => {
        $("batchImportText").value = "";
        refreshBatchPreview();
        $("batchImportModal").showModal();
      });

      $("batchImportText").addEventListener("input", () => {
        clearTimeout(batchInputDebounce);
        batchInputDebounce = setTimeout(refreshBatchPreview, 120);
      });

      $("batchAutoSplit").addEventListener("change", refreshBatchPreview);

      $("batchSampleBtn").addEventListener("click", () => {
        $("batchImportText").value = `# Космос\n\nПЛАНЕТА, ЗВЕЗДА, ОРБИТА, КОМЕТА, СПУТНИК, АСТЕРОИД, ГАЛАКТИКА\n\n# Подводный мир\nАКУЛА, ДЕЛЬФИН, КИТ, КОРАЛЛ, СКАТ, РИФ, МЕДУЗА, КРАБ, ОСЬМИНОГ\n\n1. Лесные животные: ВОЛК, ЛИСИЦА, МЕДВЕДЬ, РЫСЬ, БАРСУК, БОБР, ЗАЯЦ`;
        refreshBatchPreview();
      });

      $("batchImportCancel").addEventListener("click", () => $("batchImportModal").close());

      $("batchImportApply").addEventListener("click", () => {
        if (!activeBookId || !parsedBatchResult) {
          $("batchImportModal").close();
          return;
        }

        const book = state.books[activeBookId];
        const validTopics = parsedBatchResult.topics.filter(t => t.words.length > 0);

        if (!validTopics.length) {
          toast("Нет распознанных тем для добавления.");
          return;
        }

        validTopics.forEach(t => {
          book.topics.push({
            id: uid(),
            name: t.name,
            raw: t.raw,
            words: t.words,
            grid: null,
            placements: [],
            found: []
          });
        });

        book.updatedAt = Date.now();
        stateChanged();
        renderBookDetail();
        $("batchImportModal").close();
        toast(`Успешно добавлено ${validTopics.length} тем в сборник!`);
      });

      $("generateAllBookGridsBtn").addEventListener("click", () => generateAllBookGrids(false));
      $("batchGenCancel").addEventListener("click", () => { batchCancelRequested = true; });

      $("printFullBookBtn").addEventListener("click", printFullBook);
      $("exportBookXlsxBtn").addEventListener("click", exportBookXLSX);
      $("exportBookJsonBtn").addEventListener("click", () => {
        if (!activeBookId) return;
        const book = state.books[activeBookId];
        download(JSON.stringify(book, null, 2), `${filename(book.title)}.json`, "application/json");
      });

      $("importBookBtn").addEventListener("click", () => $("bookFileInput").click());
      $("bookFileInput").addEventListener("change", async e => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const imported = JSON.parse(await file.text());
          if (!imported || !Array.isArray(imported.topics)) throw new Error("Неверный формат файла книги");
          const id = "book:" + uid();
          imported.id = id;
          imported.updatedAt = Date.now();
          state.books[id] = imported;
          stateChanged();
          toast(`Книга «${imported.title}» успешно импортирована!`);
          openBook(id);
        } catch (err) {
          toast("Ошибка импорта: " + err.message);
        }
        e.target.value = "";
      });

      const playGrid = $("playGrid");
      playGrid.addEventListener("pointerdown", e => {
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("#playGrid .cell");
        if (!el) return;
        const idx = Number(el.dataset.index);
        pointerId = e.pointerId;
        selectionStart = idx;
        selectionCells = [idx];
        gameCursor = idx;
        playGrid.setPointerCapture(e.pointerId);
        paintGame();
      });

      playGrid.addEventListener("pointermove", e => {
        if (e.pointerId !== pointerId || selectionStart === null) return;
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("#playGrid .cell");
        if (!el) return;
        selectionCells = straightLine(selectionStart, Number(el.dataset.index));
        paintGame();
      });

      playGrid.addEventListener("pointerup", finishSelection);
      playGrid.addEventListener("pointercancel", cancelSelection);

      // Слушатели раздела «Реверс-аудит»
      $("reverseRaw").addEventListener("input", () => Reverse.readRaw());
      $("reverseWords").addEventListener("input", () => {
        Reverse.invalidate();
        Reverse.render();
      });
      $("reverseTypos").addEventListener("change", () => Reverse.invalidate());
      $("reverseScan").addEventListener("click", () => Reverse.scan());
      $("reverseFindTopic").addEventListener("click", () => Reverse.findTopic());
      $("reverseApply").addEventListener("click", () => Reverse.apply());

      $("reverseTSV").addEventListener("click", () => {
        if (Reverse.canScan()) copyText(gridTSV(Reverse.grid), "Матрица скопирована для Excel.");
      });

      $("reverseCopy").addEventListener("click", () => {
        if (Reverse.canScan()) copyText(Reverse.grid.join(""), "Скопировано 225 символов.");
      });

      $("reverseLoad").addEventListener("click", () => {
        Reverse.grid = [...currentBoardEntity().value.grid];
        Reverse.writeRaw();
        $("reverseWords").value = currentBoardEntity().value.words.join(", ");
        Reverse.render();
      });

      $("reverseClear").addEventListener("click", () => {
        Reverse.grid = Array(CELLS).fill("·");
        Reverse.active = null;
        Reverse.count = 0;
        Reverse.invalidate();
        $("reverseRaw").value = "";
        $("reverseWords").value = "";
        $("reverseLetter").value = "";
        Reverse.updateCount();
        Reverse.render();
      });

      $("reverseGrid").addEventListener("keydown", e => Reverse.handleKey(e));
      $("reverseSet").addEventListener("click", () => {
        Reverse.setLetter($("reverseLetter").value);
        $("reverseLetter").value = "";
      });
      $("reverseLetter").addEventListener("keydown", e => {
        if (e.key === "Enter") {
          e.preventDefault();
          Reverse.setLetter($("reverseLetter").value);
          $("reverseLetter").value = "";
        }
      });
      $("reverseErase").addEventListener("click", () => Reverse.setLetter("·", false));
      $("reversePrev").addEventListener("click", () => Reverse.move(-1));
      $("reverseNext").addEventListener("click", () => Reverse.move(1));

      $("soundButton").addEventListener("click", () => {
        Sound.muted = !Sound.muted;
        $("soundButton").textContent = Sound.muted ? "Звук: выкл" : "Звук: вкл";
      });

      $("syncButton").addEventListener("click", () => $("syncDialog").showModal());
      $("syncClose").addEventListener("click", () => $("syncDialog").close());
      $("syncNow").addEventListener("click", () => Sync.push());
      $("victoryClose").addEventListener("click", () => $("victoryDialog").close());
    }

    async function init() {
      await DB.open();
      const local = await DB.get("wv_firebase_local_v1");
      const savedState = local?.state || await DB.get("wv_state_v4") || await DB.get("wv_state_v3");
      if (savedState) {
        try {
          state = validateState(savedState);
        } catch {}
      }

      try { editorHistory = new StudioCore.History(await DB.get("wv_studio_history_v1") || {}); } catch {}
      bindEvents();
      bindStudioEvents();
      Reverse.init();
      renderConstructor(true);
      renderTopics();
      renderBooks();
      game = state.game || await DB.get("wv_game_v4") || null;
      if (game) state.game = clone(game);
      await Sync.init(local);
      await persistState();
      updateInputWarnings();

      setInterval(() => {
        if (game && gameRunningSince !== null) {
          $("playTimer").textContent = formatTime(elapsedGame());
          gameSaveTick++;
          if (gameSaveTick % 5 === 0) saveGame();
        }
      }, 1000);
    }

    window.addEventListener("DOMContentLoaded", init);
  })();
