const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {parseHTML}=require('linkedom');
const StudioCore=require('../assets/studio-core.js');
const StudioPrint=require('../assets/print-layout.js');
const root=path.join(__dirname,'..');
function launch(){
  const {window,document}=parseHTML(fs.readFileSync(path.join(root,'index.html'),'utf8'));
  // Linkedom does not implement browser-only dialog, select setters, or layout.
  document.querySelectorAll('dialog').forEach(d=>{d.showModal=()=>d.setAttribute('open','');d.close=()=>d.removeAttribute('open');});
  document.querySelectorAll('select').forEach(s=>Object.defineProperty(s,'value',{get(){return [...this.options].find(o=>o.selected)?.value||this.options[0]?.value||'';},set(v){for(const o of this.options)o.selected=o.value===v;},configurable:true}));
  let app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
  app=app.replace('window.addEventListener("DOMContentLoaded", init);',`
    persistState = async () => true;
    persistHistory = () => {};
    confirmModal = async () => true;
    stateChanged = () => {renderBooks();renderTopics();};
    window.__studio = {emptyBoard,commitBoard,openTopicInConstructor,switchTab,autoSaveMetaOnly,moveHistory,
      generateAllBookGrids,boardQuality,parseWords,findOccurrences,validCells,openExport,renderExport,exportData,
      performExport, newGame, exportBookXLSX,
      getGame:()=>game, state:()=>state, current:()=>currentBoardEntity().value,
      setGenerator:fn=>generateGrid=fn, attachBook:(book)=>state.books[book.id]=book,
      restoreHistory:()=>{editorHistory=new StudioCore.History(editorHistory.serialize());},
      initialize:()=>{bindEvents();bindStudioEvents();Reverse.init();renderConstructor(true);renderBooks();renderTopics();}
    };
  `);
  const context={window,document,StudioCore,StudioPrint,crypto:webcrypto,console,navigator:{},performance:{now:()=>Date.now()},setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,10)),clearTimeout,Uint8Array,TextEncoder,TextDecoder,Blob,URL};
  vm.runInNewContext(app,context);
  const api=window.__studio;api.initialize();
  return {api,window,document,$:id=>document.getElementById(id)};
}
function board(api,name='Космос',word='ОРБИТА'){
  const b=api.emptyBoard();b.id=name;b.name=name;b.raw=word;b.words=[word];b.grid=Array(225).fill('Х');for(let i=0;i<word.length;i++)b.grid[i]=word[i];b.placements=[{word,cells:[...word].map((_,i)=>i)}];return b;
}
function book(api){const a=board(api,'Первая','ЛУНА'),b=board(api,'Вторая','КОМЕТА');return {id:'book-one',title:'Книга',settings:a.settings,topics:[{...a,id:'topic-a'},{...b,id:'topic-b'}],updatedAt:1};}

test('actual HTML initializes all controls and has unique IDs',()=>{
  const {document,$}=launch();
  const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);
  assert.equal(new Set(ids).size,ids.length);
  assert.equal($('constructorGrid').children.length,225);
  assert.equal(document.querySelectorAll('nav [data-tab]').length,3);
  assert.equal($('undoButton').disabled,true);
  assert.match($('qualityDetails').textContent,/Добавьте слова/);
  for(const m of fs.readFileSync(path.join(root,'assets/app.js'),'utf8').matchAll(/\$\(["']([^"']+)["']\)/g))assert.ok(document.getElementById(m[1]),`missing element ${m[1]}`);
});
test('undo and redo restore grids and metadata, isolated per book topic and free draft',async()=>{
  const {api,$}=launch();
  api.commitBoard(board(api,'Свободная','СОЛНЦЕ'));
  api.attachBook(book(api));api.openTopicInConstructor('book-one',0);
  $('topicName').value='Новое название';$('wordsInput').value='ЛУНА';api.autoSaveMetaOnly();
  assert.equal(api.state().books['book-one'].topics[0].name,'Новое название');
  api.moveHistory(-1);assert.equal(api.current().name,'Первая');
  api.moveHistory(1);assert.equal(api.current().name,'Новое название');
  api.openTopicInConstructor('book-one',1);api.commitBoard(board(api,'Другая','МАРС'));
  api.openTopicInConstructor('book-one',0);api.moveHistory(-1);assert.equal(api.current().name,'Первая');
  assert.equal(api.state().books['book-one'].topics[1].name,'Другая');
  await api.switchTab('constructor');assert.equal(api.current().name,'Свободная');
  api.restoreHistory();api.moveHistory(-1);assert.equal(api.current().words.length,0);
  api.moveHistory(1);assert.equal(api.current().name,'Свободная');
});
test('safe batch generation preserves existing layouts and generates only missing ones',async()=>{
  const {api}=launch();const b=book(api);b.topics[1].grid=null;b.topics[1].placements=[];api.attachBook(b);
  api.openTopicInConstructor(b.id,0);await api.switchTab('books');
  const before=JSON.stringify(b.topics[0]);let calls=0;
  api.setGenerator(async()=>{calls++;const x=board(api,'Вторая','КОМЕТА');return {grid:x.grid,placements:x.placements};});
  await api.generateAllBookGrids(false);
  assert.equal(calls,1);assert.equal(JSON.stringify(b.topics[0]),before);assert.equal(b.topics[1].placements.length,1);
  await api.generateAllBookGrids(false);assert.equal(calls,1);
  await api.generateAllBookGrids(true);assert.equal(calls,3);
});
test('quality catches edited words, ambiguous occurrences, mixed alphabets and stale answers',()=>{
  const {api}=launch();const b=board(api);
  assert.equal(api.boardQuality(b).ready,true);
  b.raw='ОРБИТА ЗВЕЗДА';assert.equal(api.boardQuality(b).ready,false);
  assert.ok(api.boardQuality(b).issues.some(i=>i.title==='Слова изменились'));
  b.raw='ОРБИТА';b.grid[30]='О';b.grid[31]='Р';b.grid[32]='Б';b.grid[33]='И';b.grid[34]='Т';b.grid[35]='А';
  assert.ok(api.boardQuality(b).issues.some(i=>i.title.startsWith('Несколько')));
  b.raw='ОРБИTА';assert.ok(api.boardQuality(b).issues.some(i=>i.title==='Смешаны алфавиты'));
  b.raw='ОРБИТА';b.placements[0].cells=[100,101,102,103,104,105];assert.equal(api.boardQuality(b).ready,false);
});
test('export preview does not modify data and blocks incomplete print output',()=>{
  const {api,$}=launch();api.commitBoard(board(api));const before=JSON.stringify(api.state());api.openExport();
  assert.equal($('performExportButton').disabled,false);assert.match($('printPreview').srcdoc,/ОРБИТА/);
  assert.equal(JSON.stringify(api.state()),before);
  $('wordsInput').value='ОРБИТА НЕПТУН';api.autoSaveMetaOnly();api.renderExport();assert.equal($('performExportButton').disabled,true);
  $('exportFormat').value='json';api.renderExport();assert.equal($('performExportButton').disabled,false);
  assert.equal(JSON.stringify(api.current().words),JSON.stringify(['ОРБИТА']));
});
test('contextual play and audit use the book grid; main Constructor still returns free work',async()=>{
  const {api,$,window}=launch();api.commitBoard(board(api,'Свободная','СОЛНЦЕ'));api.attachBook(book(api));api.openTopicInConstructor('book-one',0);
  $('editorPlayButton').click();assert.equal(api.getGame().board.name,'Первая');
  await api.switchTab('constructor',{bookEditor:true});$('editorAuditButton').click();assert.equal($('reverseWords').value,'ЛУНА');
  assert.equal(api.current().name,'Первая');await api.switchTab('constructor');assert.equal(api.current().name,'Свободная');
  const settings=$('dirH');settings.checked=false;settings.dispatchEvent(new window.Event('change'));assert.equal(api.current().settings.h,false);api.moveHistory(-1);assert.equal(api.current().settings.h,true);
});
test('print pagination handles 58 topics with separate answer pages and escapes content',()=>{
  const {api}=launch();const boards=Array.from({length:58},(_,i)=>board(api,`Тема ${i+1}`));boards[0].name='<script>alert(1)</script>';
  const pages=StudioPrint.pages({title:'Книга',boards,book:true,sheets:'both'});
  assert.equal(pages.length,120); // cover + three contents + 58 puzzles + 58 answers
  assert.match(pages[1],/<span>5<\/span>/);assert.match(pages[2],/<span>29<\/span>/);
  const html=StudioPrint.documentHTML('Книга',pages.join(''));
  assert.equal(html.includes('<script>alert'),false);assert.match(html,/&lt;script&gt;/);
  assert.equal(StudioPrint.pages({title:'x',boards,sheets:'answers'}).length,58);
  assert.equal(StudioPrint.pages({title:'x',boards:[boards[0]],sheets:'puzzle'}).length,1);
});
test('history truncates redo branches, caps versions, and restores serialization',()=>{
  const h=new StudioCore.History();let old={name:'0',grid:Array(225).fill('А')};
  for(let i=1;i<=40;i++){const next={...old,name:String(i)};h.record('free',old,next);old=next;}
  assert.equal(h.get('free',old).entries.length,30);const back=h.move('free',old,-1);assert.equal(back.name,'39');
  h.record('free',back,{...back,name:'new'});assert.equal(h.move('free',{...back,name:'new'},1),null);
  const restored=new StudioCore.History(h.serialize());assert.equal(restored.move('free',{...back,name:'new'},-1).name,'39');
});
