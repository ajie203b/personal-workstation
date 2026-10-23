// Secret values stay inside this process; never put them in OS command-line arguments.
const {run}=require('@tauri-apps/cli');
const [mode,target,version]=process.argv.slice(2);
const password=process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
if (!password || !target || !['generate','sign'].includes(mode)) throw new Error('缺少签名参数');
const args=mode==='generate'
  ? ['signer','generate','--ci','--write-keys',target,'--password',password]
  : ['signer','sign','--private-key-path',process.env.TAURI_SIGNING_PRIVATE_KEY_PATH,'--app-version',version,target];
run(args,'tauri').catch(()=>{process.exitCode=1;});
