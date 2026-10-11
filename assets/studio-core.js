/* Pure, dependency-free editor history and quality rules. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudioCore = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const copy = x => JSON.parse(JSON.stringify(x));
  const signature = b => JSON.stringify([b.name,b.raw,b.words,b.settings,b.grid,b.placements]);
  class History {
    constructor(data = {}) {
      this.items = new Map();
      for (const [key, value] of Object.entries(data || {}).slice(-120)) {
        if (!Array.isArray(value.entries) || !Number.isInteger(value.cursor)) continue;
        const entries = value.entries.filter(e => e?.board && Array.isArray(e.board.grid) && e.board.grid.length === 225).slice(-30);
        if (entries.length) this.items.set(key, {entries, cursor: Math.max(0,Math.min(entries.length-1,value.cursor))});
      }
    }
    get(key, board) {
      if (!this.items.has(key)) this.items.set(key,{entries:[{board:copy(board),label:'Начальная версия',time:Date.now()}],cursor:0});
      return this.items.get(key);
    }
    record(key, before, after, label = 'Изменение сетки', coalesce = false) {
      if (signature(before) === signature(after)) return;
      const h = this.get(key,before);
      if (signature(h.entries[h.cursor].board) !== signature(before)) {
        h.entries = h.entries.slice(0,h.cursor+1);
        h.entries.push({board:copy(before),label:'Текущее состояние',time:Date.now()});
        h.cursor = h.entries.length-1;
      }
      const last = h.entries[h.cursor];
      const merge = coalesce && h.cursor === h.entries.length-1 && h.cursor > 0 && last.label === label && Date.now()-last.time < 900;
      h.entries = h.entries.slice(0,h.cursor+1);
      const entry = {board:copy(after),label,time:Date.now()};
      if (merge) h.entries[h.cursor] = entry;
      else h.entries.push(entry);
      h.entries = h.entries.slice(-30);
      h.cursor = h.entries.length-1;
      this.items.delete(key); this.items.set(key,h);
      if (this.items.size>120) this.items.delete(this.items.keys().next().value);
    }
    move(key, board, delta) {
      const h = this.get(key,board);
      if (signature(h.entries[h.cursor].board) !== signature(board)) this.record(key,h.entries[h.cursor].board,board,'Внешнее изменение');
      const target = h.cursor+delta;
      if (target<0 || target>=h.entries.length) return null;
      h.cursor=target;
      return copy(h.entries[target].board);
    }
    serialize() { return Object.fromEntries(this.items); }
  }
  function quality(board, parseWords, occurrences, validCells) {
    const parsed = parseWords(board.raw || '');
    const words = parsed.words;
    const issues=[];
    const add=(level,title,detail)=>issues.push({level,title,detail});
    if (!words.length) add('error','Добавьте слова','Список слов пока пуст.');
    if (parsed.rejected.length) add('error','Некорректная длина',parsed.rejected.join('; '));
    if (parsed.duplicates) add('warn','Повторы в списке',`${parsed.duplicates} повторов исключено при генерации.`);
    const mixed=words.filter(w=>/[А-Я]/.test(w)&&/[A-Z]/.test(w));
    if (mixed.length) add('error','Смешаны алфавиты',mixed.join(', '));
    if (JSON.stringify(words)!==JSON.stringify(board.words)) add('error','Слова изменились','Перестройте сетку для актуального списка.');
    const missing=[], ambiguous=[];
    for (const word of words) {
      const found=occurrences(board.grid || [],word,0,3);
      if (!found.length) missing.push(word);
      if (found.length>1) ambiguous.push(word);
    }
    if (missing.length) add('error',`Не найдены: ${missing.length}`,missing.join(', '));
    if (ambiguous.length) add('warn',`Несколько вхождений: ${ambiguous.length}`,ambiguous.join(', '));
    const placements=board.placements||[];
    const invalid=placements.filter(p=>!words.includes(p.word)||!validCells(p.cells,p.word,board.grid||[]));
    if (invalid.length) add('error','Ответы не совпадают с сеткой',invalid.map(p=>p.word).join(', '));
    const noAnswer=words.filter(w=>!placements.some(p=>p.word===w && validCells(p.cells,w,board.grid||[])));
    if (noAnswer.length && missing.length!==words.length) add('error','Неполный лист ответов',noAnswer.join(', '));
    const disallowed=placements.filter(p=>{
      if(!validCells(p.cells,p.word,board.grid||[]))return false;
      const dr=Math.floor(p.cells[1]/15)-Math.floor(p.cells[0]/15),dc=p.cells[1]%15-p.cells[0]%15;
      return (dr===0&&!board.settings?.h)||(dc===0&&!board.settings?.v)||(dr!==0&&dc!==0&&!board.settings?.d)||(!board.settings?.reverse&&(dr<0||(dr===0&&dc<0)));
    });
    if(disallowed.length)add('error','Направления изменились','Перестройте сетку по выбранным правилам.');
    if(board.settings?.overlap===false){const cells=placements.flatMap(p=>p.cells);if(new Set(cells).size<cells.length)add('error','Есть пересечения','Перестройте сетку без общих букв.');}
    const totalLetters=words.reduce((n,w)=>n+w.length,0);
    if (board.settings?.overlap===false && totalLetters>225) add('error','Слова не поместятся',`${totalLetters} букв при 225 клетках без пересечений.`);
    if (!['h','v','d'].some(k=>board.settings?.[k])) add('error','Нет направлений','Включите хотя бы одно направление.');
    const grid=board.grid||[];
    if (grid.length!==225 || grid.some(ch=>!/^[А-ЯA-Z·]$/.test(ch))) add('error','Некорректное поле','Поле должно содержать 225 букв или точек.');
    const dots=grid.filter(ch=>ch==='·').length;
    if (dots && words.length && missing.length<words.length) add('warn','Есть незаполненные клетки',`${dots} клеток с точками попадут в экспорт.`);
    return {issues, total:words.length, found:words.length-missing.length, ready:words.length>0&&!issues.some(x=>x.level==='error')};
  }
  const needsGeneration = topic => !Array.isArray(topic.grid) || topic.grid.length!==225 || !(topic.placements||[]).length;
  return {History,quality,needsGeneration,signature};
});
