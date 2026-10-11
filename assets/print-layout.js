/* Shared A4 layout: the preview is an actual page of the exported document. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.StudioPrint=api;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const coord=i=>String.fromCharCode(65+i%15)+(Math.floor(i/15)+1);
  function rules(s={}){const dirs=[];if(s.h)dirs.push('по горизонтали');if(s.v)dirs.push('по вертикали');if(s.d)dirs.push('по диагонали');return `Найдите слова ${dirs.join(', ')}${s.reverse?', в том числе в обратном направлении':''}. ${s.overlap===false?'Слова не пересекаются.':'Слова могут пересекаться.'}`;}
  function pages({title,author='',boards,book=false,sheets='both'}){
    const result=[];
    const puzzlePages=boards.map((b,i)=>puzzle(b,i,false));
    if(book&&sheets!=='answers'){
      result.push(`<div class="cover"><div class="eyebrow">WORDVAULT / КОЛЛЕКЦИЯ</div><h1>${esc(title)}</h1><p>${boards.length} филвордов · 15 × 15</p><div class="author">${esc(author)}</div></div>`);
      const chunks=Math.ceil(boards.length/24);
      let pageNumber=2+chunks;
      const pageNumbers=puzzlePages.map(group=>{const first=pageNumber;pageNumber+=group.length;return first;});
      for(let i=0;i<chunks;i++)result.push(`<div class="eyebrow">СОДЕРЖАНИЕ</div><h1>Темы книги</h1><div class="toc">${boards.slice(i*24,(i+1)*24).map((b,j)=>`<div><span>${i*24+j+1}. ${esc(b.name)}</span><span>${pageNumbers[i*24+j]}</span></div>`).join('')}</div>`);
    }
    if(sheets!=='answers')puzzlePages.forEach(group=>result.push(...group));
    if(sheets!=='puzzle')boards.forEach((b,i)=>result.push(...puzzle(b,i,true)));
    return result.map((content,i)=>`<section class="page">${content}<footer><span>${esc(title)}</span><span>${i+1} / ${result.length}</span></footer></section>`);
  }
  function answerRoutes(b){
    const paths=(b.placements||[]).map((placement,index)=>{
      const cells=placement.cells||[];
      if(cells.length<2||!cells.every(n=>Number.isInteger(n)&&n>=0&&n<225))return '';
      const a=cells[0],z=cells[cells.length-1];
      const x1=(a%15+.5)*100,y1=(Math.floor(a/15)+.5)*100;
      const x2=(z%15+.5)*100,y2=(Math.floor(z/15)+.5)*100;
      const colors=['#376854','#526c9b','#946532','#905c83','#507d78','#826eaa'];
      const c=colors[index%colors.length];
      const angle=Math.atan2(y2-y1,x2-x1),back=23,wing=13;
      const ax=x2-back*Math.cos(angle)+wing*Math.sin(angle);
      const ay=y2-back*Math.sin(angle)-wing*Math.cos(angle);
      const bx=x2-back*Math.cos(angle)-wing*Math.sin(angle);
      const by=y2-back*Math.sin(angle)+wing*Math.cos(angle);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="white" stroke-width="16" stroke-linecap="round"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="10" stroke-linecap="round"/><circle cx="${x1}" cy="${y1}" r="14" fill="${c}" stroke="white" stroke-width="4"/><polygon points="${x2},${y2} ${ax},${ay} ${bx},${by}" fill="${c}" stroke="white" stroke-width="2"/>`;
    }).join('');
    return `<svg class="answer-routes-print" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 1500" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>`;
  }
  function puzzle(b,i,answer){
    const occupied=new Set((b.placements||[]).flatMap(p=>p.cells));
    const entries=answer?(b.placements||[]).map(p=>`<span>${esc(p.word)} <small>${coord(p.cells[0])}–${coord(p.cells.at(-1))}</small></span>`):b.words.map(w=>`<span>□ ${esc(w)}</span>`);
    const head=`<div class="eyebrow">${answer?'ОТВЕТЫ':'ФИЛВОРД'} / ${String(i+1).padStart(2,'0')}</div><h1>${esc(b.name)}</h1>`;
    const result=[`<div class="puzzle-heading">${head}<p class="rules">${esc(answer?'Сетка ответов и координаты слов.':rules(b.settings))}</p></div><div class="grid">${(b.grid||Array(225).fill('·')).map((ch,n)=>`<span>${answer&&!occupied.has(n)?'':esc(ch)}</span>`).join('')}${answer?answerRoutes(b):''}</div><h2>${answer?'Координаты':`Найдите ${b.words.length} слов`}${entries.length>24?' · список продолжается на следующей странице':''}</h2><div class="words">${entries.slice(0,24).join('')}</div>`];
    for(let start=24;start<entries.length;start+=90)result.push(`${head}<h2>${answer?'Координаты':'Список слов'} · продолжение</h2><div class="words continuation">${entries.slice(start,start+90).join('')}</div>`);
    return result;
  }
  function documentHTML(title,content,preview=false){return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
    @page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#e9eae4;color:#222;font-family:Arial,sans-serif}.page{position:relative;width:210mm;height:297mm;padding:16mm 20mm 22mm;background:white;margin:0 auto 8mm;break-after:page;page-break-after:always;overflow-wrap:anywhere}.page:last-child{break-after:auto;page-break-after:auto}.eyebrow{font-size:8pt;letter-spacing:1.3pt;color:#777;margin-bottom:6mm}h1{font-size:20pt;line-height:1.15;font-weight:500;margin:0 0 4mm}h2{font-size:10pt;font-weight:500;margin:7mm 0 3mm}.rules{font-size:9pt;line-height:1.5;margin:0 0 8mm}.puzzle-heading{height:46mm}.grid{width:145mm;height:145mm;display:grid;grid-template-columns:repeat(15,1fr);grid-template-rows:repeat(15,1fr);border-top:.25mm solid #bbb;border-left:.25mm solid #bbb;margin:0 auto}.grid span{display:flex;align-items:center;justify-content:center;border-right:.25mm solid #bbb;border-bottom:.25mm solid #bbb;font:12pt monospace}.grid{position:relative}.answer-routes-print{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1}.words{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2mm 5mm;font-size:8pt}.words span{break-inside:avoid}.words.continuation{margin-top:10mm;row-gap:4mm}.words small{color:#666;font-size:6.5pt}footer{position:absolute;bottom:12mm;left:20mm;right:20mm;border-top:.2mm solid #ddd;padding-top:3mm;display:flex;justify-content:space-between;gap:5mm;font-size:7pt;color:#888}footer span:first-child{max-width:85%}.cover{min-height:247mm;display:flex;flex-direction:column;justify-content:center}.cover h1{font-size:42pt;line-height:1.12}.cover p{font-size:12pt;color:#777}.author{margin-top:20mm;font-size:11pt}.toc{font-size:9pt}.toc>div{min-height:7mm;display:flex;justify-content:space-between;border-bottom:.2mm solid #eee;padding:1.5mm 0;gap:6mm}.controls{position:fixed;top:10px;right:10px;z-index:2;padding:10px;background:#fff;border:1px solid #ddd}.controls button{padding:8px 12px;cursor:pointer}@media print{body{background:#fff}.page{margin:0}.controls{display:none}}
    ${preview?'.page{margin:0;transform-origin:top left}body{background:white}@media(max-width:790px){.page{zoom:.65}}@media(max-width:530px){.page{zoom:.56}}@media(max-width:450px){.page{zoom:.46}}@media(max-width:360px){.page{zoom:.38}}':''}
    </style></head><body>${content}</body></html>`;}
  return {pages,documentHTML,rules,esc};
});
