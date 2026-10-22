import{c as r,aV as s,aW as c}from"./index-DXxiFDDc.js";/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const i=[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["polyline",{points:"7 10 12 15 17 10",key:"2ggqvy"}],["line",{x1:"12",x2:"12",y1:"15",y2:"3",key:"1vk2je"}]],u=r("Download",i);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const d=[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",key:"v9h5vc"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",key:"3uifl3"}],["path",{d:"M8 16H3v5",key:"1cv678"}]],v=r("RefreshCw",d),y=c("FileExport");async function l(o){const t=new Uint8Array(await o.arrayBuffer());let n="";const e=32768;for(let a=0;a<t.length;a+=e)n+=String.fromCharCode(...t.subarray(a,a+e));return btoa(n)}async function f(o,t){if(s.isNativePlatform()){const a=await l(o);return(await y.saveToDownloads({dataBase64:a,fileName:t,mimeType:o.type||"application/octet-stream"})).path||`下载/个人工作站/${t}`}const n=URL.createObjectURL(o),e=document.createElement("a");return e.href=n,e.download=t,e.rel="noopener",document.body.appendChild(e),e.click(),e.remove(),window.setTimeout(()=>URL.revokeObjectURL(n),2e3),"浏览器下载目录"}export{u as D,v as R,f as s};
