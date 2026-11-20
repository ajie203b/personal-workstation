const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./jszip.min-RNvUI9IB.js","./index-Bb5MCt7o.js","./index-CWtXt6Iy.css","./jszip.min-BtmiRcdI.js","./docs-CbPQyYo3.js"])))=>i.map(i=>d[i]);
import{_ as T,k as q}from"./index-Bb5MCt7o.js";import{f as C,a as j}from"./fanqie-Bcecche0.js";import"./saveFile-K9xVUpuP.js";function M(e){return(e.replace(/[<>:"/\\|?*\u0000-\u001f]/g,t=>({"<":"＜",">":"＞",":":"：",'"':"＂","/":"／","\\":"＼","|":"｜","?":"？","*":"＊"})[t]??"").replace(/\s+/g," ").trim().replace(/[. ]+$/,"")||"番茄小说").slice(0,80)}function B(e){return[...e].sort((r,t)=>r.index-t.index)}function R(e,r){const t=[`《${e.title}》`,`作者：${e.author}`,`状态：${e.status||"未知"}`],o=C(e.wordCount);o&&t.push(`字数：${o}`),t.push(`已收录：${r} / ${e.chapterCount} 章`);const c=j(e.updatedAt);return c&&t.push(`官网更新：${c}`),e.abstract&&t.push("","简介：",e.abstract),t.push("","—".repeat(18),""),t.join(`
`)}function G(e,r){const t=B(r),o=[R(e,t.length)];let c="";for(const l of t)l.volume&&l.volume!==c&&(c=l.volume,o.push(`
【${c}】
`)),o.push(`
${l.title}

${l.content}
`);return new Blob(["\uFEFF"+o.join(`
`)],{type:"text/plain;charset=utf-8"})}function i(e){return e.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;")}function z(e){return e.split(`
`).map(r=>r.trim()).filter(Boolean).map(r=>`<p>${i(r)}</p>`).join(`
`)}function v(e,r){return`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>${i(e)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${r}
</body>
</html>`}function V(e,r){const t=new Uint8Array(e.slice(0,16));if(t.length<4)return null;if(t[0]===255&&t[1]===216)return{ext:"jpg",mediaType:"image/jpeg"};if(t[0]===137&&t[1]===80&&t[2]===78&&t[3]===71)return{ext:"png",mediaType:"image/png"};if(t.length>=12&&t[0]===82&&t[1]===73&&t[2]===70&&t[3]===70&&t[8]===87&&t[9]===69&&t[10]===66&&t[11]===80)return{ext:"webp",mediaType:"image/webp"};if(t[0]===71&&t[1]===73&&t[2]===70)return{ext:"gif",mediaType:"image/gif"};if(r.startsWith("image/")){const o=r.split(";")[0].trim().toLowerCase();return{ext:o==="image/png"?"png":o==="image/webp"?"webp":o==="image/gif"?"gif":"jpg",mediaType:o}}return null}async function Z(e){if(!e)return null;const r=e.replace(/^http:\/\//i,"https://");try{const{bytes:t,contentType:o}=await q(r,{timeoutMs:6e3,proxyFallback:!0}),c=V(t,o);return c?{filename:`cover.${c.ext}`,mediaType:c.mediaType,bytes:t}:null}catch{return null}}function H(e,r){const t=C(e.wordCount),o=j(e.updatedAt),c=[`<p><strong>书名：</strong>${i(e.title)}</p>`,`<p><strong>作者：</strong>${i(e.author||"佚名")}</p>`,e.status?`<p><strong>状态：</strong>${i(e.status)}</p>`:"",t?`<p><strong>字数：</strong>${i(t)}</p>`:"",`<p><strong>章节：</strong>已收录 ${r} / ${e.chapterCount||r} 章</p>`,o?`<p><strong>更新：</strong>${i(o)}</p>`:"",e.tags.length?`<p><strong>标签：</strong>${i(e.tags.join(" · "))}</p>`:""].filter(Boolean),l=e.abstract?`  <h2>简介正文</h2>
  ${z(e.abstract)}`:"";return v(`书籍简介 - ${e.title}`,`  <div class="intro">
    <h1>书籍简介</h1>
    <div class="intro-meta">
      ${c.join(`
      `)}
    </div>
${l}
  </div>`)}async function W(e,r,t){var S,F,O;const o=B(r);if(!o.length)throw new Error("还没有下载任何章节");const c=(await T(async()=>{const{default:n}=await import("./jszip.min-RNvUI9IB.js").then(a=>a.j);return{default:n}},__vite__mapDeps([0,1,2,3]),import.meta.url)).default,l=new c;l.file("mimetype","application/epub+zip",{compression:"STORE"}),l.file("META-INF/container.xml",`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);const m=await Z(e.cover);m&&l.file(`OEBPS/${m.filename}`,m.bytes);const h=o.map((n,a)=>{const s=`chapter-${String(a+1).padStart(4,"0")}.xhtml`;return l.file(`OEBPS/${s}`,v(n.title,`  <h1>${i(n.title)}</h1>
  ${z(n.content)}`)),{ch:n,name:s,id:`c${String(a+1).padStart(4,"0")}`}}),p=[];for(const n of h){const a=((S=n.ch.volume)==null?void 0:S.trim())||void 0,s=p[p.length-1];!s||s.volume!==a?p.push({volume:a,chapters:[n]}):s.chapters.push(n)}const b=p.some(n=>!!n.volume),_=b&&(t==null?void 0:t.volumePages)!==!1,P=[];if(_){let n=0;for(const a of p){if(!a.volume)continue;n++;const s=`volume-${String(n).padStart(4,"0")}.xhtml`,d=`v${String(n).padStart(4,"0")}`;a.pageName=s,a.pageId=d,P.push({id:d,name:s});const u=((F=a.chapters[0])==null?void 0:F.ch.title)??"",w=((O=a.chapters[a.chapters.length-1])==null?void 0:O.ch.title)??"",A=a.chapters.length>1?`共 ${a.chapters.length} 章 · ${u} — ${w}`:`共 ${a.chapters.length} 章 · ${u}`;l.file(`OEBPS/${s}`,v(a.volume,`  <div class="volume-page">
    <h1>${i(a.volume)}</h1>
    <p>${i(A)}</p>
  </div>`))}}l.file("OEBPS/style.css",`body { font-family: "Noto Serif SC", "Songti SC", serif; line-height: 1.85; margin: 1.2em; }
h1 { font-size: 1.4em; line-height: 1.5; margin: 1em 0 1.2em; }
h2 { font-size: 1.15em; line-height: 1.5; margin: 1.2em 0 0.6em; }
p { margin: 0.75em 0; text-indent: 2em; }
.cover { text-align: center; padding: 2.5em 1em 2em; page-break-after: always; break-after: page; }
.cover-image { max-width: 72%; max-height: 24em; height: auto; margin: 0 auto 1.4em; display: block; }
.cover h1 { font-size: 1.9em; text-indent: 0; margin: 0.4em 0; }
.cover p { text-indent: 0; color: #666; margin: 0.3em 0; }
.intro { page-break-after: always; break-after: page; }
.intro-meta { margin: 1em 0 1.4em; padding: 0.75em 1em; border-left: 3px solid #cccccc; }
.intro-meta p { text-indent: 0; margin: 0.25em 0; font-size: 0.92em; color: #555555; }
.volume-page { text-align: center; padding: 4em 1em 2em; page-break-after: always; break-after: page; }
.volume-page h1 { font-size: 1.55em; margin: 0 0 0.6em; text-indent: 0; }
.volume-page p { text-indent: 0; color: #666666; font-size: 0.92em; }`);const N=m?`  <div class="cover">
    <img class="cover-image" src="${m.filename}" alt="${i(e.title)}"/>
    <h1>${i(e.title)}</h1>
    <p>${i(e.author)}</p>
  </div>`:`  <div class="cover">
    <h1>${i(e.title)}</h1>
    <p>${i(e.author)}</p>
  </div>`;l.file("OEBPS/cover.xhtml",v("封面",N)),l.file("OEBPS/intro.xhtml",H(e,o.length));const $=['      <li><a href="cover.xhtml">封面</a></li>','      <li><a href="intro.xhtml">书籍简介</a></li>'];for(const n of p)if(n.volume){const a=n.pageName?`<a href="${n.pageName}">${i(n.volume)}</a>`:`<span>${i(n.volume)}</span>`,s=n.chapters.map(({ch:d,name:u})=>`          <li><a href="${u}">${i(d.title)}</a></li>`).join(`
`);$.push(`      <li>
        ${a}
        <ol>
${s}
        </ol>
      </li>`)}else for(const{ch:a,name:s}of n.chapters)$.push(`      <li><a href="${s}">${i(a.title)}</a></li>`);l.file("OEBPS/nav.xhtml",`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>目录</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${$.join(`
`)}
    </ol>
  </nav>
</body>
</html>`);let f=1;const x=[`    <navPoint id="np-intro" playOrder="${f++}">
      <navLabel><text>书籍简介</text></navLabel>
      <content src="intro.xhtml"/>
    </navPoint>`];let E=0,g=0;for(const n of p)if(n.volume){E++;const a=f++,s=n.pageName??n.chapters[0].name,d=n.chapters.map(({ch:u,name:w})=>(g++,`      <navPoint id="np${g}" playOrder="${f++}">
        <navLabel><text>${i(u.title)}</text></navLabel>
        <content src="${w}"/>
      </navPoint>`)).join(`
`);x.push(`    <navPoint id="np-vol-${E}" playOrder="${a}">
      <navLabel><text>${i(n.volume)}</text></navLabel>
      <content src="${s}"/>
${d}
    </navPoint>`)}else for(const{ch:a,name:s}of n.chapters)g++,x.push(`    <navPoint id="np${g}" playOrder="${f++}">
      <navLabel><text>${i(a.title)}</text></navLabel>
      <content src="${s}"/>
    </navPoint>`);l.file("OEBPS/toc.ncx",`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:fanqie:${i(e.id)}"/>
    <meta name="dtb:depth" content="${b?"2":"1"}"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${i(e.title)}</text></docTitle>
  <navMap>
${x.join(`
`)}
  </navMap>
</ncx>`);const L=[m?`    <item id="cover-image" href="${m.filename}" media-type="${m.mediaType}" properties="cover-image"/>`:"",...P.map(({id:n,name:a})=>`    <item id="${n}" href="${a}" media-type="application/xhtml+xml"/>`),...h.map(({name:n,id:a})=>`    <item id="${a}" href="${n}" media-type="application/xhtml+xml"/>`)].filter(Boolean),y=['    <itemref idref="cover"/>','    <itemref idref="intro"/>'];for(const n of p){n.pageId&&y.push(`    <itemref idref="${n.pageId}"/>`);for(const{id:a}of n.chapters)y.push(`    <itemref idref="${a}"/>`)}const D=e.tags.map(n=>`    <dc:subject>${i(n)}</dc:subject>`).join(`
`),I=new Date().toISOString().replace(/\.\d{3}Z$/,"Z");return l.file("OEBPS/content.opf",`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:fanqie:${i(e.id)}</dc:identifier>
    <dc:title>${i(e.title)}</dc:title>
    <dc:creator>${i(e.author)}</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:description>${i(e.abstract)}</dc:description>
    <dc:source>https://fanqienovel.com/page/${i(e.id)}</dc:source>
${m?`    <meta name="cover" content="cover-image"/>
`:""}${D}
    <meta property="dcterms:modified">${I}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="intro" href="intro.xhtml" media-type="application/xhtml+xml"/>
${L.join(`
`)}
  </manifest>
  <spine toc="ncx">
${y.join(`
`)}
  </spine>
</package>`),l.generateAsync({type:"blob",mimeType:"application/epub+zip",compression:"DEFLATE"})}async function K(e,r){const t=await W(e,r),o=new File([t],`${M(e.title)}.epub`,{type:"application/epub+zip"}),{importDoc:c}=await T(async()=>{const{importDoc:m}=await import("./docs-CbPQyYo3.js").then(h=>h.o);return{importDoc:m}},__vite__mapDeps([4,1,2]),import.meta.url);return(await c(o)).doc.id}export{W as a,G as b,K as i,M as s};
