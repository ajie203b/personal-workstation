const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./jszip.min-BuFWUUsn.js","./index-FzMp1At7.js","./index-Bub279w9.css","./jszip.min--Y9keFq3.js","./docs-DG7ELS_G.js"])))=>i.map(i=>d[i]);
import{_ as d}from"./index-FzMp1At7.js";import{f as $,a as v}from"./fanqie-E9U27Dyq.js";import"./saveFile-Cw1Jtgi-.js";function y(t){return(t.replace(/[<>:"/\\|?*\u0000-\u001f]/g,e=>({"<":"＜",">":"＞",":":"：",'"':"＂","/":"／","\\":"＼","|":"｜","?":"？","*":"＊"})[e]??"").replace(/\s+/g," ").trim().replace(/[. ]+$/,"")||"番茄小说").slice(0,80)}function h(t){return[...t].sort((i,e)=>i.index-e.index)}function w(t,i){const e=[`《${t.title}》`,`作者：${t.author}`,`状态：${t.status||"未知"}`],o=$(t.wordCount);o&&e.push(`字数：${o}`),e.push(`已收录：${i} / ${t.chapterCount} 章`);const n=v(t.updatedAt);return n&&e.push(`官网更新：${n}`),t.abstract&&e.push("","简介：",t.abstract),e.push("","—".repeat(18),""),e.join(`
`)}function z(t,i){const e=h(i),o=[w(t,e.length)];let n="";for(const l of e)l.volume&&l.volume!==n&&(n=l.volume,o.push(`
【${n}】
`)),o.push(`
${l.title}

${l.content}
`);return new Blob(["\uFEFF"+o.join(`
`)],{type:"text/plain;charset=utf-8"})}function r(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;")}function b(t){return t.split(`
`).map(i=>i.trim()).filter(Boolean).map(i=>`<p>${r(i)}</p>`).join(`
`)}function E(t,i){return`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>${r(t)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>${r(t)}</h1>
  ${b(i)}
</body>
</html>`}async function C(t,i){const e=h(i);if(!e.length)throw new Error("还没有下载任何章节");const o=(await d(async()=>{const{default:a}=await import("./jszip.min-BuFWUUsn.js").then(c=>c.j);return{default:a}},__vite__mapDeps([0,1,2,3]),import.meta.url)).default,n=new o;n.file("mimetype","application/epub+zip",{compression:"STORE"}),n.file("META-INF/container.xml",`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);const l=e.map((a,c)=>{const s=`chapter-${String(c+1).padStart(4,"0")}.xhtml`;return n.file(`OEBPS/${s}`,E(a.title,a.content)),{ch:a,name:s,id:`c${String(c+1).padStart(4,"0")}`}});n.file("OEBPS/style.css",`body { font-family: "Noto Serif SC", "Songti SC", serif; line-height: 1.85; margin: 1.2em; }
h1 { font-size: 1.4em; line-height: 1.5; margin: 1em 0 1.2em; }
p { margin: 0.75em 0; text-indent: 2em; }
.cover { display: flex; flex-direction: column; justify-content: center; align-items: center; height: 80vh; text-align: center; }
.cover h1 { font-size: 2em; text-indent: 0; }
.cover p { text-indent: 0; color: #666; }`),n.file("OEBPS/cover.xhtml",`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>封面</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><div class="cover"><h1>${r(t.title)}</h1><p>${r(t.author)}</p></div></body>
</html>`);const m=l.map(({ch:a,name:c})=>`      <li><a href="${c}">${r(a.title)}</a></li>`).join(`
`);n.file("OEBPS/nav.xhtml",`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>目录</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${m}
    </ol>
  </nav>
</body>
</html>`);const p=l.map(({ch:a,name:c},s)=>`    <navPoint id="np${s+1}" playOrder="${s+1}">
      <navLabel><text>${r(a.title)}</text></navLabel>
      <content src="${c}"/>
    </navPoint>`).join(`
`);n.file("OEBPS/toc.ncx",`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:fanqie:${r(t.id)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${r(t.title)}</text></docTitle>
  <navMap>
${p}
  </navMap>
</ncx>`);const u=l.map(({name:a,id:c})=>`    <item id="${c}" href="${a}" media-type="application/xhtml+xml"/>`).join(`
`),f=l.map(({id:a})=>`    <itemref idref="${a}"/>`).join(`
`),x=t.tags.map(a=>`    <dc:subject>${r(a)}</dc:subject>`).join(`
`),g=new Date().toISOString().replace(/\.\d{3}Z$/,"Z");return n.file("OEBPS/content.opf",`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:fanqie:${r(t.id)}</dc:identifier>
    <dc:title>${r(t.title)}</dc:title>
    <dc:creator>${r(t.author)}</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:description>${r(t.abstract)}</dc:description>
    <dc:source>https://fanqienovel.com/page/${r(t.id)}</dc:source>
${x}
    <meta property="dcterms:modified">${g}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
${u}
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover"/>
${f}
  </spine>
</package>`),n.generateAsync({type:"blob",mimeType:"application/epub+zip",compression:"DEFLATE"})}async function O(t,i){const e=await C(t,i),o=new File([e],`${y(t.title)}.epub`,{type:"application/epub+zip"}),{importDoc:n}=await d(async()=>{const{importDoc:m}=await import("./docs-DG7ELS_G.js").then(p=>p.l);return{importDoc:m}},__vite__mapDeps([4,1,2]),import.meta.url);return(await n(o)).doc.id}export{C as a,z as b,O as i,y as s};
