function a(r){return r<1024?`${Math.max(0,Math.round(r))} B`:r<1024*1024?`${Math.max(1,Math.round(r/1024))} KB`:`${(r/1024/1024).toFixed(1)} MB`}export{a as f};
