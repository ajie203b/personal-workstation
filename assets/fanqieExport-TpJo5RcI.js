const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./jszip.min-m8gS2vCc.js","./index-BoPf4mq4.js","./index-DTa7ffM-.css","./jszip.min-C9h0FRg3.js","./docTextIndex-D-do1x5O.js","./pptxXml-CMH_SWFY.js"])))=>i.map(i=>d[i]);
import{_ as E,A as q}from"./index-BoPf4mq4.js";import{f as A,a as C}from"./fanqie-DPJQo2N2.js";import"./saveFile-7kvVvJ3I.js";function H(t){return(t.replace(/[<>:"/\\|?*\u0000-\u001f]/g,e=>({"<":"＜",">":"＞",":":"：",'"':"＂","/":"／","\\":"＼","|":"｜","?":"？","*":"＊"})[e]??"").replace(/\s+/g," ").trim().replace(/[. ]+$/,"")||"番茄小说").slice(0,80)}function j(t){return[...t].sort((o,e)=>o.index-e.index)}function R(t,o){const e=[`《${t.title}》`,`作者：${t.author}`,`状态：${t.status||"未知"}`],s=A(t.wordCount);s&&e.push(`字数：${s}`),e.push(`已收录：${o} / ${t.chapterCount} 章`);const l=C(t.updatedAt);return l&&e.push(`官网更新：${l}`),t.abstract&&e.push("","简介：",t.abstract),e.push("","—".repeat(18),""),e.join(`
`)}function G(t,o){const e=j(o),s=[R(t,e.length)];let l="";for(const a of e)a.volume&&a.volume!==l&&(l=a.volume,s.push(`
【${l}】
`)),s.push(`
${a.title}

${a.content}
`);return new Blob(["\uFEFF"+s.join(`
`)],{type:"text/plain;charset=utf-8"})}function r(t){return t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;")}function D(t){return t.split(`
`).map(o=>o.trim()).filter(Boolean).map(o=>`<p>${r(o)}</p>`).join(`
`)}function S(t,o){return`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>${r(t)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${o}
</body>
</html>`}function V(t,o){const e=new Uint8Array(t.slice(0,16));if(e.length<4)return null;if(e[0]===255&&e[1]===216)return{ext:"jpg",mediaType:"image/jpeg"};if(e[0]===137&&e[1]===80&&e[2]===78&&e[3]===71)return{ext:"png",mediaType:"image/png"};if(e.length>=12&&e[0]===82&&e[1]===73&&e[2]===70&&e[3]===70&&e[8]===87&&e[9]===69&&e[10]===66&&e[11]===80)return{ext:"webp",mediaType:"image/webp"};if(e[0]===71&&e[1]===73&&e[2]===70)return{ext:"gif",mediaType:"image/gif"};if(o.startsWith("image/")){const s=o.split(";")[0].trim().toLowerCase();return{ext:s==="image/png"?"png":s==="image/webp"?"webp":s==="image/gif"?"gif":"jpg",mediaType:s}}return null}async function M(t){if(!t)return null;const o=t.replace(/^http:\/\//i,"https://");try{const{bytes:e,contentType:s}=await q(o,{timeoutMs:6e3,proxyFallback:!0}),l=V(e,s);return l?{filename:`cover.${l.ext}`,mediaType:l.mediaType,bytes:e}:null}catch{return null}}function U(t,o){const e=A(t.wordCount),s=C(t.updatedAt),l=[`<p><strong>书名：</strong>${r(t.title)}</p>`,`<p><strong>作者：</strong>${r(t.author||"佚名")}</p>`,t.status?`<p><strong>状态：</strong>${r(t.status)}</p>`:"",e?`<p><strong>字数：</strong>${r(e)}</p>`:"",`<p><strong>章节：</strong>已收录 ${o} / ${t.chapterCount||o} 章</p>`,s?`<p><strong>更新：</strong>${r(s)}</p>`:"",t.tags.length?`<p><strong>标签：</strong>${r(t.tags.join(" · "))}</p>`:""].filter(Boolean),a=t.abstract?`  <h2>简介正文</h2>
  ${D(t.abstract)}`:"";return S(`书籍简介 - ${t.title}`,`  <div class="intro">
    <h1>书籍简介</h1>
    <div class="intro-meta">
      ${l.join(`
      `)}
    </div>
${a}
  </div>`)}async function Z(t,o,e){var B,F,z;const s=j(o);if(!s.length)throw new Error("还没有下载任何章节");const l=(await E(async()=>{const{default:n}=await import("./jszip.min-m8gS2vCc.js").then(i=>i.j);return{default:n}},__vite__mapDeps([0,1,2,3]),import.meta.url)).default,a=new l;a.file("mimetype","application/epub+zip",{compression:"STORE"}),a.file("META-INF/container.xml",`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);const d=await M(t.cover);d&&a.file(`OEBPS/${d.filename}`,d.bytes);const _=s.map((n,i)=>{const p=`chapter-${String(i+1).padStart(4,"0")}.xhtml`;return a.file(`OEBPS/${p}`,S(n.title,`  <h1>${r(n.title)}</h1>
  ${D(n.content)}`)),{ch:n,name:p,id:`c${String(i+1).padStart(4,"0")}`}}),m=[];for(const n of _){const i=((B=n.ch.volume)==null?void 0:B.trim())||void 0,p=m[m.length-1];!p||p.volume!==i?m.push({volume:i,chapters:[n]}):p.chapters.push(n)}const b=m.some(n=>!!n.volume),h=b&&(e==null?void 0:e.volumePages)!==!1,u=[];if(h){let n=0;for(const i of m){if(!i.volume)continue;n++;const p=`volume-${String(n).padStart(4,"0")}.xhtml`,w=`v${String(n).padStart(4,"0")}`;i.pageName=p,i.pageId=w,u.push({id:w,name:p});const y=((F=i.chapters[0])==null?void 0:F.ch.title)??"",T=((z=i.chapters[i.chapters.length-1])==null?void 0:z.ch.title)??"",N=i.chapters.length>1?`共 ${i.chapters.length} 章 · ${y} — ${T}`:`共 ${i.chapters.length} 章 · ${y}`;a.file(`OEBPS/${p}`,S(i.volume,`  <div class="volume-page">
    <h1>${r(i.volume)}</h1>
    <p>${r(N)}</p>
  </div>`))}}a.file("OEBPS/style.css",`body { font-family: "Noto Serif SC", "Songti SC", serif; line-height: 1.85; margin: 1.2em; }
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
.volume-page p { text-indent: 0; color: #666666; font-size: 0.92em; }`);const f=d?`  <div class="cover">
    <img class="cover-image" src="${d.filename}" alt="${r(t.title)}"/>
    <h1>${r(t.title)}</h1>
    <p>${r(t.author)}</p>
  </div>`:`  <div class="cover">
    <h1>${r(t.title)}</h1>
    <p>${r(t.author)}</p>
  </div>`;a.file("OEBPS/cover.xhtml",S("封面",f)),a.file("OEBPS/intro.xhtml",U(t,s.length));const g=['      <li><a href="cover.xhtml">封面</a></li>','      <li><a href="intro.xhtml">书籍简介</a></li>'];for(const n of m)if(n.volume){const i=n.pageName?`<a href="${n.pageName}">${r(n.volume)}</a>`:`<span>${r(n.volume)}</span>`,p=n.chapters.map(({ch:w,name:y})=>`          <li><a href="${y}">${r(w.title)}</a></li>`).join(`
`);g.push(`      <li>
        ${i}
        <ol>
${p}
        </ol>
      </li>`)}else for(const{ch:i,name:p}of n.chapters)g.push(`      <li><a href="${p}">${r(i.title)}</a></li>`);a.file("OEBPS/nav.xhtml",`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>目录</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${g.join(`
`)}
    </ol>
  </nav>
</body>
</html>`);let v=1;const c=[`    <navPoint id="np-intro" playOrder="${v++}">
      <navLabel><text>书籍简介</text></navLabel>
      <content src="intro.xhtml"/>
    </navPoint>`];let P=0,x=0;for(const n of m)if(n.volume){P++;const i=v++,p=n.pageName??n.chapters[0].name,w=n.chapters.map(({ch:y,name:T})=>(x++,`      <navPoint id="np${x}" playOrder="${v++}">
        <navLabel><text>${r(y.title)}</text></navLabel>
        <content src="${T}"/>
      </navPoint>`)).join(`
`);c.push(`    <navPoint id="np-vol-${P}" playOrder="${i}">
      <navLabel><text>${r(n.volume)}</text></navLabel>
      <content src="${p}"/>
${w}
    </navPoint>`)}else for(const{ch:i,name:p}of n.chapters)x++,c.push(`    <navPoint id="np${x}" playOrder="${v++}">
      <navLabel><text>${r(i.title)}</text></navLabel>
      <content src="${p}"/>
    </navPoint>`);a.file("OEBPS/toc.ncx",`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:fanqie:${r(t.id)}"/>
    <meta name="dtb:depth" content="${b?"2":"1"}"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${r(t.title)}</text></docTitle>
  <navMap>
${c.join(`
`)}
  </navMap>
</ncx>`);const O=[d?`    <item id="cover-image" href="${d.filename}" media-type="${d.mediaType}" properties="cover-image"/>`:"",...u.map(({id:n,name:i})=>`    <item id="${n}" href="${i}" media-type="application/xhtml+xml"/>`),..._.map(({name:n,id:i})=>`    <item id="${i}" href="${n}" media-type="application/xhtml+xml"/>`)].filter(Boolean),$=['    <itemref idref="cover"/>','    <itemref idref="intro"/>'];for(const n of m){n.pageId&&$.push(`    <itemref idref="${n.pageId}"/>`);for(const{id:i}of n.chapters)$.push(`    <itemref idref="${i}"/>`)}const L=t.tags.map(n=>`    <dc:subject>${r(n)}</dc:subject>`).join(`
`),I=new Date().toISOString().replace(/\.\d{3}Z$/,"Z");return a.file("OEBPS/content.opf",`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:fanqie:${r(t.id)}</dc:identifier>
    <dc:title>${r(t.title)}</dc:title>
    <dc:creator>${r(t.author)}</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:description>${r(t.abstract)}</dc:description>
    <dc:source>https://fanqienovel.com/page/${r(t.id)}</dc:source>
${d?`    <meta name="cover" content="cover-image"/>
`:""}${L}
    <meta property="dcterms:modified">${I}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="intro" href="intro.xhtml" media-type="application/xhtml+xml"/>
${O.join(`
`)}
  </manifest>
  <spine toc="ncx">
${$.join(`
`)}
  </spine>
</package>`),a.generateAsync({type:"blob",mimeType:"application/epub+zip",compression:"DEFLATE"})}async function J(t,o){const e=await Z(t,o),s=new File([e],`${H(t.title)}.epub`,{type:"application/epub+zip"}),l=`fanqie:${t.id}`,[{db:a},{importDoc:d},{sha256Hex:_}]=await Promise.all([E(()=>import("./index-BoPf4mq4.js").then(c=>c.dG),__vite__mapDeps([1,2]),import.meta.url),E(()=>import("./index-BoPf4mq4.js").then(c=>c.dI),__vite__mapDeps([1,2]),import.meta.url),E(()=>import("./modelCache-CVZbekeS.js"),[],import.meta.url)]),m=await a.docs.where("sourceUrl").equals(l).filter(c=>!c.deletedAt).first();if(!m){const c=await d(s);return await a.docs.update(c.doc.id,{sourceUrl:l,updatedAt:Date.now()}),c.doc.id}const b=await e.arrayBuffer(),h=await _(b);if(h===m.hash)return m.id;const u=m.hash,f=Date.now(),g=new Blob([b],{type:"application/epub+zip"});await a.transaction("rw",[a.docs,a.blobs,a.positions,a.annotations,a.bookmarks,a.docText,a.tombstones],async()=>{await a.blobs.put({hash:h,blob:g}),await a.docs.update(m.id,{hash:h,title:t.title.trim()||m.title,size:g.size,updatedAt:f,sourceUrl:l});const c=await a.positions.get(u);c&&(await a.positions.put({...c,hash:h,updatedAt:f}),await a.positions.delete(u),await a.tombstones.put({id:u,ts:f}));const P=await a.annotations.where("docHash").equals(u).toArray();P.length&&await a.annotations.bulkPut(P.map($=>({...$,docHash:h,updatedAt:f})));const x=await a.bookmarks.where("docHash").equals(u).toArray();x.length&&await a.bookmarks.bulkPut(x.map($=>({...$,docHash:h,updatedAt:f}))),await a.docs.where("hash").equals(u).count()===0&&(await a.blobs.delete(u),await a.docText.delete(u))});const v=await a.docs.get(m.id);return v&&E(async()=>{const{indexDoc:c}=await import("./docTextIndex-D-do1x5O.js");return{indexDoc:c}},__vite__mapDeps([4,1,2,5]),import.meta.url).then(({indexDoc:c})=>c(v,g)),m.id}export{Z as a,G as b,J as i,H as s};
