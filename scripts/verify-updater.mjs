import {createHash,createPublicKey,timingSafeEqual,verify} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

function decodeBase64(text) {
  const value=text.trim();
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('更新签名不是有效的 Base64');
  const bytes=Buffer.from(value,'base64');
  if (bytes.toString('base64')!==value) throw new Error('更新签名编码不完整');
  return bytes;
}

/** Tauri 包装的 Minisign 格式，使用 Node/OpenSSL Ed25519 验证，不实现签名算法。
 * 协议依据：https://jedisct1.github.io/minisign/#signature-format
 */
export function verifyUpdaterArtifact({artifact,pubkey,signature,version,filename,manifest,repository='ajie203b/personal-workstation'}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('目标版本无效');
  const publicLines=decodeBase64(pubkey).toString('utf8').replaceAll('\r\n','\n').trimEnd().split('\n');
  const lines=decodeBase64(signature).toString('utf8').replaceAll('\r\n','\n').trimEnd().split('\n');
  if (publicLines.length!==2 || !publicLines[0].startsWith('untrusted comment: ') || lines.length!==4 || !lines[0].startsWith('untrusted comment: ') || !lines[2].startsWith('trusted comment: ')) throw new Error('更新签名格式无效');
  const publicBytes=decodeBase64(publicLines[1]);
  const signedBytes=decodeBase64(lines[1]);
  const globalSignature=decodeBase64(lines[3]);
  if (publicBytes.length!==42 || publicBytes.subarray(0,2).toString()!=='Ed' || signedBytes.length!==74 || globalSignature.length!==64) throw new Error('更新签名长度或公钥格式无效');
  if (!timingSafeEqual(publicBytes.subarray(2,10),signedBytes.subarray(2,10))) throw new Error('更新签名的密钥标识不匹配');
  const algorithm=signedBytes.subarray(0,2).toString();
  if (algorithm!=='ED' && algorithm!=='Ed') throw new Error('不支持的更新签名算法');
  const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),publicBytes.subarray(10)]),format:'der',type:'spki'});
  const fileSignature=signedBytes.subarray(10);
  const data=algorithm==='ED' ? createHash('blake2b512').update(artifact).digest() : artifact;
  if (!verify(null,data,publicKey,fileSignature)) throw new Error('安装包签名验证失败');
  const comment=lines[2].slice('trusted comment: '.length);
  if (!verify(null,Buffer.concat([fileSignature,Buffer.from(comment)]),publicKey,globalSignature)) throw new Error('安装包签名元数据验证失败');
  const signedVersions=comment.split('\t').filter(field=>field.startsWith('version:'));
  if (signedVersions.length!==1 || signedVersions[0]!==`version:${version}`) throw new Error('签名未绑定目标版本');
  if (manifest) {
    const platform=manifest.platforms?.['windows-x86_64'];
    const expectedName=`Kairos_${version}_x64-setup.exe`;
    const expectedUrl=`https://github.com/${repository}/releases/download/v${version}/${expectedName}`;
    if (filename!==expectedName || manifest.version!==version || !Number.isFinite(Date.parse(manifest.pub_date)) || platform?.signature?.trim()!==signature.trim() || platform?.url!==expectedUrl) throw new Error('更新清单与本次安装包、版本或签名不一致');
  }
  return {version,filename,algorithm,sha256:createHash('sha256').update(artifact).digest('hex')};
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const {values}=parseArgs({options:Object.fromEntries(['config','artifact','signature','version','manifest'].map(name=>[name,{type:'string'}]))});
    for (const key of ['config','artifact','signature','version']) if (!values[key]) throw new Error(`缺少参数 --${key}`);
    const config=JSON.parse(readFileSync(values.config,'utf8'));
    console.log(JSON.stringify(verifyUpdaterArtifact({artifact:readFileSync(values.artifact),pubkey:config.plugins?.updater?.pubkey,signature:readFileSync(values.signature,'utf8'),version:values.version,filename:basename(values.artifact),manifest:values.manifest ? JSON.parse(readFileSync(values.manifest,'utf8').replace(/^\uFEFF/,'')) : undefined})));
  } catch (error) { console.error(error.message);process.exitCode=1; }
}
