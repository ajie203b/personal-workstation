import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {verifyUpdaterArtifact} from './verify-updater.mjs';

function fixture() {
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const id=randomBytes(8);
  const key=Buffer.concat([Buffer.from('Ed'),id,publicKey.export({format:'der',type:'spki'}).subarray(-32)]);
  const pubkey=Buffer.from(`untrusted comment: test key\n${key.toString('base64')}\n`).toString('base64');
  const artifact=Buffer.from('Synthetic updater fixture');
  const fileSignature=sign(null,createHash('blake2b512').update(artifact).digest(),privateKey);
  const comment='timestamp:1\tfile:Kairos_3.4.2_x64-setup.exe\tversion:3.4.2';
  const globalSignature=sign(null,Buffer.concat([fileSignature,Buffer.from(comment)]),privateKey);
  const signature=Buffer.from(`untrusted comment: fixture\n${Buffer.concat([Buffer.from('ED'),id,fileSignature]).toString('base64')}\ntrusted comment: ${comment}\n${globalSignature.toString('base64')}\n`).toString('base64');
  const manifest={version:'3.4.2',pub_date:'2026-10-23T15:00:00Z',platforms:{'windows-x86_64':{signature,url:'https://github.com/ajie203b/personal-workstation/releases/download/v3.4.2/Kairos_3.4.2_x64-setup.exe'}}};
  return {artifact,pubkey,signature,version:'3.4.2',filename:'Kairos_3.4.2_x64-setup.exe',manifest};
}

test('accepts a valid minisign artifact and matching update manifest',()=>{
  assert.equal(verifyUpdaterArtifact(fixture()).version,'3.4.2');
});
test('rejects changed executable bytes',()=>{
  const f=fixture();f.artifact=Buffer.from('tampered');assert.throws(()=>verifyUpdaterArtifact(f));
});
test('rejects a public key from another signing identity',()=>{
  const f=fixture();f.pubkey=fixture().pubkey;assert.throws(()=>verifyUpdaterArtifact(f));
});
test('rejects a changed trusted version comment',()=>{
  const f=fixture();f.signature=Buffer.from(Buffer.from(f.signature,'base64').toString().replace('version:3.4.2','version:3.4.3')).toString('base64');assert.throws(()=>verifyUpdaterArtifact(f));
});
test('rejects a changed global signature',()=>{
  const f=fixture();const lines=Buffer.from(f.signature,'base64').toString().trim().split('\n');lines[3]=Buffer.alloc(64).toString('base64');f.signature=Buffer.from(lines.join('\n')).toString('base64');assert.throws(()=>verifyUpdaterArtifact(f));
});
test('rejects manifest version and signature mismatches',()=>{
  const f=fixture();f.manifest.version='3.4.3';assert.throws(()=>verifyUpdaterArtifact(f));
  f.manifest.version='3.4.2';f.manifest.platforms['windows-x86_64'].signature=fixture().signature;assert.throws(()=>verifyUpdaterArtifact(f));
});
test('rejects a manifest pointing to another release or host',()=>{
  const f=fixture();f.manifest.platforms['windows-x86_64'].url='https://example.com/installer.exe';assert.throws(()=>verifyUpdaterArtifact(f));
});
test('rejects unsigned version reuse and malformed encodings',()=>{
  const f=fixture();f.version='3.4.3';assert.throws(()=>verifyUpdaterArtifact(f));
  f.version='3.4.2';f.signature='invalid';assert.throws(()=>verifyUpdaterArtifact(f));
});
