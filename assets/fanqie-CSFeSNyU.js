import{q as a}from"./index-D7Xxz8ny.js";function f(t){const e=t.trim();if(!e)return null;const r=e.match(/(?:fanqienovel\.com|fqnovel\.com)\/reader\/(\d{6,20})/i);if(r)return{kind:"chapter",id:r[1]};const n=e.match(/(?:fanqienovel\.com|fqnovel\.com)\/page\/(\d{6,20})/i);if(n)return{kind:"book",id:n[1]};const i=e.match(/(?:book_id|bookId|bookid|item_id|itemId)=(\d{6,20})/i);if(i)return{kind:"auto",id:i[1]};const o=e.match(/^(\d{6,20})$/);return o?{kind:"auto",id:o[1]}:null}const c={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" ",ldquo:"“",rdquo:"”",lsquo:"‘",rsquo:"’",hellip:"…",mdash:"—"};function u(t){return t.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi,(e,r)=>{if(r[0]==="#"){const n=r[1]==="x"||r[1]==="X",i=Number.parseInt(n?r.slice(2):r.slice(1),n?16:10);if(!Number.isFinite(i)||i<0||i>1114111)return e;try{return String.fromCodePoint(i)}catch{return e}}return c[r.toLowerCase()]??e})}function l(t){let e=t.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<br\s*\/?>/gi,`
`).replace(/<\/(p|div|section|h[1-6]|li|blockquote)>/gi,`

`);return e=e.replace(/<[^>]+>/g,""),e=u(e),e=e.replace(/\r\n?/g,`
`).replace(/[\u200b-\u200d\u2060\ufeff]/g,"").split(`
`).map(r=>r.replace(/[ \t]+/g," ").trim()).join(`
`),e.replace(/\n{3,}/g,`

`).trim()}function p(t){if(!t||t<=0)return"";if(t<1e4)return`${t} 字`;if(t<1e8){const e=t/1e4;return`${e>=100?e.toFixed(0):e.toFixed(1).replace(/\.0$/,"")} 万字`}return`${(t/1e8).toFixed(1).replace(/\.0$/,"")} 亿字`}function d(t){if(!t)return"";const e=new Date(t);return Number.isNaN(e.getTime())?"":a(e)}export{d as a,l as c,u as d,p as f,f as p};
