const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
module.exports = async function render(chrome,dir,url,width,height,screenshot) {
 const profile=path.join(dir,'profile');
 const child=spawn(chrome,['--headless','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let socket;
 try {
  const portFile=path.join(profile,'DevToolsActivePort');
  let portInfo;
  for(let i=0;i<100;i++){
   try {
    const value=fs.readFileSync(portFile,'utf8').trim();
    if(/^\d+\r?\n\/devtools\/browser\/.+/.test(value)){portInfo=value;break;}
   } catch(error){if(!['ENOENT','EBUSY','EPERM'].includes(error.code))throw error;}
   await wait(100);
  }
  if(!portInfo)throw Error('Chrome did not provide its debugging port');
  const [port,endpoint]=portInfo.split(/\r?\n/);
  socket=new WebSocket('ws://127.0.0.1:'+port+endpoint);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map();
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const {resolve,reject,timer}=pending.get(m.id);clearTimeout(timer);pending.delete(m.id);m.error?reject(Error(m.error.message)):resolve(m.result);}};
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const req=++id;const timer=setTimeout(()=>{pending.delete(req);reject(Error('Timeout '+method));},12000);pending.set(req,{resolve,reject,timer});socket.send(JSON.stringify({id:req,method,params,sessionId}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const page=(method,params)=>send(method,params,sessionId);
  await page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await page('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await page('Page.navigate',{url});
  let output;
  for(let i=0;i<100;i++){
   const result=await page('Runtime.evaluate',{expression:'document.getElementById("result")?.textContent',returnByValue:true});
   output=result.result.value;if(output)break;await wait(50);
  }
  const viewport=await page('Runtime.evaluate',{expression:'innerWidth',returnByValue:true});
  if(viewport.result.value!==width)throw Error('Wrong viewport '+viewport.result.value);
  if(!output)throw Error('Missing browser checks');
  await wait(300);
  const shot=await page('Page.captureScreenshot',{format:'png'});fs.writeFileSync(screenshot,Buffer.from(shot.data,'base64'));
  const checks=JSON.parse(output);
  await send('Browser.close').catch(()=>{});
  return checks;
 } finally {
  socket?.close();
  // Let Chrome release its profile before removing the temporary fixture.
  if(child.exitCode===null) await new Promise(resolve=>{const timer=setTimeout(resolve,2000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
  if(child.exitCode===null){child.kill();await wait(500);}
  await wait(250);
 }
};
